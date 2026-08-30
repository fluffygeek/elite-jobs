import { and, eq } from "drizzle-orm";
import type { AnyPgColumn, PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db";
import { jobs, markets, users, type FiberCode } from "@/db/schema";
import { computeBoreCode } from "@/lib/domain/bore-payment-tier";
import { deriveJobSite } from "@/lib/domain/job-site";
import type { TechnicianWritableJobFields } from "@/lib/domain/job-fields";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, typeof import("@/db/schema")>;

export type Job = typeof jobs.$inferSelect;

// Fields a Technician submits from the job intake form, plus the
// server-injected technicianId (see src/lib/domain/job-fields.ts — never
// part of the canonical schema itself, added by the caller after
// validation). Note what's deliberately absent: jobSiteState/jobSiteZip and
// boreCode are never accepted here — they're always server-computed below
// (see AGENTS.md's ground rules and src/db/schema.ts's comments on those
// columns).
export type CreateJobInput = TechnicianWritableJobFields & {
  technicianId: string;
};

export class DuplicateJobNumberError extends Error {
  constructor(jobNumber: string) {
    super(`A Job with number "${jobNumber}" already exists in this Market.`);
    this.name = "DuplicateJobNumberError";
  }
}

// Postgres unique_violation SQLSTATE. Both the postgres.js driver and PGlite
// surface this on the underlying error object's `code` property; Drizzle
// wraps that in a DrizzleQueryError whose `cause` is the original error, so
// check both the error itself and its `cause`.
const UNIQUE_VIOLATION_CODE = "23505";

function hasUniqueViolationCode(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION_CODE
  );
}

function isUniqueViolation(error: unknown): boolean {
  if (hasUniqueViolationCode(error)) {
    return true;
  }
  if (error instanceof Error && error.cause) {
    return hasUniqueViolationCode(error.cause);
  }
  return false;
}

/**
 * Creates a Job. Job Site (state + zip) is derived from the Address and Bore
 * Code is computed from Bore Footage — both server-side, both never trusted
 * from client input (see the domain functions in src/lib/domain/). Rejects a
 * duplicate `(market_id, job_number)` with a specific, named error rather
 * than letting the raw Postgres constraint error leak to callers.
 */
export async function createJob(input: CreateJobInput, db: Db = defaultDb) {
  const jobSite = deriveJobSite(input.address);
  const boreCode = computeBoreCode(input.boreFootage);

  try {
    const [job] = await db
      .insert(jobs)
      .values({
        id: input.id,
        marketId: input.marketId,
        technicianId: input.technicianId,
        jobNumber: input.jobNumber,
        date: input.date,
        address: input.address,
        jobSiteState: jobSite.state,
        jobSiteZip: jobSite.zip,
        fiberCode: input.fiberCode,
        fiberFootage: input.fiberFootage,
        boreFootage: input.boreFootage,
        boreCode,
        locate: input.locate,
        directionalBore: input.directionalBore,
        prebury: input.prebury,
        techNotes: input.techNotes ?? "",
      })
      .returning();

    return job;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateJobNumberError(input.jobNumber);
    }
    throw error;
  }
}

// Thrown by syncJob when a retried sync reuses a client-generated id that
// already exists on the server but with *different* submitted data — a
// genuinely unexpected state (the same offline-queued Job should always
// resubmit identical data), distinct from DuplicateJobNumberError which
// covers two different Jobs colliding on (market_id, job_number).
export class ConflictingSyncError extends Error {
  constructor(id: string) {
    super(`Job ${id} already exists with different data than this sync submitted.`);
    this.name = "ConflictingSyncError";
  }
}

function submittedDataMatches(
  existing: typeof jobs.$inferSelect,
  input: CreateJobInput,
): boolean {
  return (
    existing.marketId === input.marketId &&
    existing.technicianId === input.technicianId &&
    existing.jobNumber === input.jobNumber &&
    existing.date.getTime() === input.date.getTime() &&
    existing.address === input.address &&
    existing.fiberCode === input.fiberCode &&
    existing.fiberFootage === input.fiberFootage &&
    existing.boreFootage === input.boreFootage &&
    existing.locate === input.locate &&
    existing.directionalBore === input.directionalBore &&
    existing.prebury === input.prebury &&
    (existing.techNotes ?? "") === (input.techNotes ?? "")
  );
}

/**
 * Idempotent upsert for the offline-sync path (api/sync). A retried sync of
 * the same client-generated id is recognized by looking the id up first,
 * rather than by attempting an insert and reacting to a conflict:
 *
 * - id doesn't exist yet → insert it via createJob (still subject to the
 *   normal (market_id, job_number) duplicate check for a *different* Job).
 * - id exists with identical submitted data → no-op success (this is the
 *   retried-sync case the offline queue is built around: same client,
 *   dropped connection, retry).
 * - id exists with different submitted data → ConflictingSyncError, a real
 *   problem rather than a silently-accepted retry.
 */
export async function syncJob(
  input: CreateJobInput,
  db: Db = defaultDb,
): Promise<{ job: typeof jobs.$inferSelect; created: boolean }> {
  const [existing] = await db.select().from(jobs).where(eq(jobs.id, input.id));

  if (existing) {
    if (submittedDataMatches(existing, input)) {
      return { job: existing, created: false };
    }
    throw new ConflictingSyncError(input.id);
  }

  const job = await createJob(input, db);
  return { job, created: true };
}

// Office Staff dashboard reads Jobs across every Market in one list (issue
// #7's core view). Joins in Market name and Technician email for display —
// there's nowhere else the dashboard can get either without a second
// round-trip per row.
export interface JobListRow {
  job: Job;
  marketName: string;
  technicianEmail: string;
}

export async function listJobs(db: Db = defaultDb): Promise<JobListRow[]> {
  return db
    .select({
      job: jobs,
      marketName: markets.name,
      technicianEmail: users.email,
    })
    .from(jobs)
    .innerJoin(markets, eq(jobs.marketId, markets.id))
    .innerJoin(users, eq(jobs.technicianId, users.id))
    .orderBy(jobs.date);
}

// --- Per-field compare-and-swap updates -----------------------------------
//
// This is the mechanism AGENTS.md's ground rules and issue #1's spec both
// point to as the crux of the whole project: every Job field is its own
// "field group of one". A save never touches the whole row — it's a
// conditional `UPDATE jobs SET <field> = :new WHERE id = :id AND <field> =
// :expectedOld`, checked via the affected-row count, not an
// application-level "read current value, compare in JS, then write" (which
// has a race condition between the read and the write). Two edits to
// *different* fields on the same Job never contend with each other at all,
// since each CAS only ever guards its own column in the WHERE clause.
//
// Zero rows affected is ambiguous on its own — it means either "the job
// doesn't exist" or "someone else already changed this exact field" — so we
// distinguish the two with a follow-up existence check and throw a specific
// error for each, per AGENTS.md's "explicit errors, no silent failures"
// principle.

export class JobNotFoundError extends Error {
  constructor(id: string) {
    super(`Job not found: ${id}`);
    this.name = "JobNotFoundError";
  }
}

export class FieldConflictError extends Error {
  constructor(public readonly field: string) {
    super(`This ${field} was just changed by someone else — reload to see the latest value.`);
    this.name = "FieldConflictError";
  }
}

// Internal only: the public surface is the typed per-field functions below,
// each of which knows its own column and (where relevant) which derived
// columns must be recomputed alongside it. Column/value typing is loosened
// here (Drizzle's column generics don't unify cleanly across heterogeneous
// callers) — every exported caller below is fully typed, so this stays an
// implementation detail, not a hole in the public API.
async function casUpdateJobField(
  id: string,
  fieldLabel: string,
  column: AnyPgColumn,
  expectedOldValue: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValues: Record<string, any>,
  db: Db,
): Promise<Job> {
  const [updated] = await db
    .update(jobs)
    .set(setValues)
    .where(and(eq(jobs.id, id), eq(column, expectedOldValue)))
    .returning();

  if (updated) {
    return updated;
  }

  const [existing] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!existing) {
    throw new JobNotFoundError(id);
  }
  throw new FieldConflictError(fieldLabel);
}

/**
 * Updates a Job's Address via compare-and-swap. Job Site (state + zip) is
 * re-derived from the new Address and persisted alongside it — it's derived,
 * never entered independently (see CONTEXT.md's "Job Site" entry) — so a
 * corrected Address always keeps its Job Site in sync.
 */
export async function updateJobAddress(
  id: string,
  expectedOldAddress: string,
  newAddress: string,
  db: Db = defaultDb,
): Promise<Job> {
  const jobSite = deriveJobSite(newAddress);
  return casUpdateJobField(
    id,
    "Address",
    jobs.address,
    expectedOldAddress,
    { address: newAddress, jobSiteState: jobSite.state, jobSiteZip: jobSite.zip, updatedAt: new Date() },
    db,
  );
}

export async function updateJobFiberCode(
  id: string,
  expectedOldFiberCode: FiberCode,
  newFiberCode: FiberCode,
  db: Db = defaultDb,
): Promise<Job> {
  return casUpdateJobField(
    id,
    "Fiber Code",
    jobs.fiberCode,
    expectedOldFiberCode,
    { fiberCode: newFiberCode, updatedAt: new Date() },
    db,
  );
}

export async function updateJobFiberFootage(
  id: string,
  expectedOldFiberFootage: number,
  newFiberFootage: number,
  db: Db = defaultDb,
): Promise<Job> {
  return casUpdateJobField(
    id,
    "Fiber Footage",
    jobs.fiberFootage,
    expectedOldFiberFootage,
    { fiberFootage: newFiberFootage, updatedAt: new Date() },
    db,
  );
}

/**
 * Updates a Job's Bore Footage via compare-and-swap. Bore Code is recomputed
 * from the new footage and persisted alongside it, per AGENTS.md's "Bore
 * Code is computed, never client-trusted" ground rule.
 */
export async function updateJobBoreFootage(
  id: string,
  expectedOldBoreFootage: number,
  newBoreFootage: number,
  db: Db = defaultDb,
): Promise<Job> {
  const boreCode = computeBoreCode(newBoreFootage);
  return casUpdateJobField(
    id,
    "Bore Footage",
    jobs.boreFootage,
    expectedOldBoreFootage,
    { boreFootage: newBoreFootage, boreCode, updatedAt: new Date() },
    db,
  );
}

export async function updateJobLocate(
  id: string,
  expectedOldLocate: boolean,
  newLocate: boolean,
  db: Db = defaultDb,
): Promise<Job> {
  return casUpdateJobField(
    id,
    "Locate",
    jobs.locate,
    expectedOldLocate,
    { locate: newLocate, updatedAt: new Date() },
    db,
  );
}

export async function updateJobDirectionalBore(
  id: string,
  expectedOldDirectionalBore: boolean,
  newDirectionalBore: boolean,
  db: Db = defaultDb,
): Promise<Job> {
  return casUpdateJobField(
    id,
    "Directional Bore",
    jobs.directionalBore,
    expectedOldDirectionalBore,
    { directionalBore: newDirectionalBore, updatedAt: new Date() },
    db,
  );
}

export async function updateJobPrebury(
  id: string,
  expectedOldPrebury: boolean,
  newPrebury: boolean,
  db: Db = defaultDb,
): Promise<Job> {
  return casUpdateJobField(
    id,
    "Prebury",
    jobs.prebury,
    expectedOldPrebury,
    { prebury: newPrebury, updatedAt: new Date() },
    db,
  );
}

export async function updateJobTechNotes(
  id: string,
  expectedOldTechNotes: string,
  newTechNotes: string,
  db: Db = defaultDb,
): Promise<Job> {
  return casUpdateJobField(
    id,
    "Tech Notes",
    jobs.techNotes,
    expectedOldTechNotes,
    { techNotes: newTechNotes, updatedAt: new Date() },
    db,
  );
}

/**
 * Updates a Job's Discrepancy Flag via compare-and-swap. A toggle, not a
 * one-directional action — per CONTEXT.md's "Discrepancy Flag" entry, Office
 * Staff can both set it and clear it once resolved.
 */
export async function updateJobDiscrepancyFlag(
  id: string,
  expectedOldDiscrepancyFlag: boolean,
  newDiscrepancyFlag: boolean,
  db: Db = defaultDb,
): Promise<Job> {
  return casUpdateJobField(
    id,
    "Discrepancy Flag",
    jobs.discrepancyFlag,
    expectedOldDiscrepancyFlag,
    { discrepancyFlag: newDiscrepancyFlag, updatedAt: new Date() },
    db,
  );
}

/**
 * Updates a Job's Close-Out status via compare-and-swap. CONTEXT.md's
 * "Close-Out" entry doesn't forbid reverting a Job to awaiting Close-Out, so
 * this is a toggle like every other field-group here, for consistency with
 * Discrepancy Flag rather than an invented one-way restriction.
 */
export async function updateJobClosedOut(
  id: string,
  expectedOldClosedOut: boolean,
  newClosedOut: boolean,
  db: Db = defaultDb,
): Promise<Job> {
  return casUpdateJobField(
    id,
    "Close-Out",
    jobs.closedOut,
    expectedOldClosedOut,
    { closedOut: newClosedOut, updatedAt: new Date() },
    db,
  );
}
