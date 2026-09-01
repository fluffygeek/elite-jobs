import { and, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn, PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db";
import { jobs, markets, users, type FiberCode } from "@/db/schema";
import { computeBoreCode } from "@/lib/domain/bore-payment-tier";
import { resolveMarketNameForState } from "@/lib/domain/market-from-state";
import { getMarketByName } from "@/db/queries/markets";
import type { TechnicianWritableJobFields } from "@/lib/domain/job-fields";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, typeof import("@/db/schema")>;

export type Job = typeof jobs.$inferSelect;

// Fields a Technician submits from the job intake form, plus the
// server-injected technicianId (see src/lib/domain/job-fields.ts — never
// part of the canonical schema itself, added by the caller after
// validation). Note what's deliberately absent: `marketId` is never accepted
// here — createJob derives it internally from `addressState` (see
// resolveMarketNameForState below) — and boreCode is always server-computed
// (see AGENTS.md's ground rules and src/db/schema.ts's comment on that
// column).
export type CreateJobInput = TechnicianWritableJobFields & {
  technicianId: string;
};

export class DuplicateJobNumberError extends Error {
  constructor(jobNumber: string) {
    super(`A Job with number "${jobNumber}" already exists in this Market.`);
    this.name = "DuplicateJobNumberError";
  }
}

// Thrown when a Job's addressState doesn't resolve to one of the two
// supported Markets (Florida or Georgia) — see
// src/lib/domain/market-from-state.ts. Distinct from DuplicateJobNumberError
// (a different, unrelated rejection reason) per issue #33's spec.
export class UnsupportedMarketError extends Error {
  constructor(state: string) {
    super(`No supported Market for state "${state}". Supported states: FL, GA.`);
    this.name = "UnsupportedMarketError";
  }
}

// Resolves the Market a new Job belongs to from its addressState — the only
// place `marketId` is ever produced; never accepted as client input (see
// CreateJobInput above and issue #33's spec).
async function resolveMarketId(state: string, db: Db): Promise<string> {
  const marketName = resolveMarketNameForState(state);
  if (!marketName) {
    throw new UnsupportedMarketError(state);
  }

  const market = await getMarketByName(marketName, db);
  if (!market) {
    throw new UnsupportedMarketError(state);
  }

  return market.id;
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
 * Creates a Job. Market is derived from addressState (never accepted as
 * client input — see resolveMarketId above) and Bore Code is computed from
 * Bore Footage — both server-side. Rejects a duplicate `(market_id,
 * job_number)` with a specific, named error rather than letting the raw
 * Postgres constraint error leak to callers, and rejects an addressState
 * outside FL/GA with UnsupportedMarketError.
 */
export async function createJob(input: CreateJobInput, db: Db = defaultDb) {
  const marketId = await resolveMarketId(input.addressState, db);
  const boreCode = computeBoreCode(input.boreFootage);

  try {
    const [job] = await db
      .insert(jobs)
      .values({
        id: input.id,
        marketId,
        technicianId: input.technicianId,
        jobNumber: input.jobNumber,
        date: input.date,
        addressStreet: input.addressStreet,
        addressLine2: input.addressLine2 || null,
        addressCity: input.addressCity,
        addressState: input.addressState,
        addressZip: input.addressZip || null,
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
    existing.technicianId === input.technicianId &&
    existing.jobNumber === input.jobNumber &&
    existing.date.getTime() === input.date.getTime() &&
    existing.addressStreet === input.addressStreet &&
    (existing.addressLine2 ?? "") === (input.addressLine2 ?? "") &&
    existing.addressCity === input.addressCity &&
    existing.addressState === input.addressState &&
    (existing.addressZip ?? "") === (input.addressZip ?? "") &&
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
  // A plain `eq(column, null)` compiles to `column = NULL`, which is never
  // true in SQL even when the column genuinely is NULL — so a nullable
  // field (addressLine2, addressZip) whose expected old value is `null`
  // needs `IS NULL` instead, or its compare-and-swap would spuriously
  // report a conflict on every attempt to match a currently-null value.
  const matchesExpectedOldValue =
    expectedOldValue === null ? isNull(column) : eq(column, expectedOldValue);

  const [updated] = await db
    .update(jobs)
    .set(setValues)
    .where(and(eq(jobs.id, id), matchesExpectedOldValue))
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

// Updates a Job's structured address fields via compare-and-swap. Each field
// is its own field-group of one, same as every other CAS updater below —
// there's no re-derivation to keep in sync here (unlike the old single
// Address + Job Site pair), since Market is only ever resolved once, at
// creation time, and editing an address field afterward doesn't move a Job
// between Markets (see src/db/queries/jobs.ts's createJob and issue #33's
// spec — moving Markets on a correction is explicitly not this ticket's
// concern). `addressLine2`/`addressZip` are nullable columns; the empty
// string a plain-text dashboard form submits for "no value" is normalized to
// `null` on write and back to `""` for CAS comparison, so callers never have
// to reason about the null/empty-string distinction themselves.
function normalizeNullableAddressPart(value: string): string | null {
  return value === "" ? null : value;
}

export async function updateJobAddressStreet(
  id: string,
  expectedOldStreet: string,
  newStreet: string,
  db: Db = defaultDb,
): Promise<Job> {
  return casUpdateJobField(
    id,
    "Address Street",
    jobs.addressStreet,
    expectedOldStreet,
    { addressStreet: newStreet, updatedAt: new Date() },
    db,
  );
}

export async function updateJobAddressLine2(
  id: string,
  expectedOldLine2: string,
  newLine2: string,
  db: Db = defaultDb,
): Promise<Job> {
  return casUpdateJobField(
    id,
    "Address Line 2",
    jobs.addressLine2,
    normalizeNullableAddressPart(expectedOldLine2),
    { addressLine2: normalizeNullableAddressPart(newLine2), updatedAt: new Date() },
    db,
  );
}

export async function updateJobAddressCity(
  id: string,
  expectedOldCity: string,
  newCity: string,
  db: Db = defaultDb,
): Promise<Job> {
  return casUpdateJobField(
    id,
    "Address City",
    jobs.addressCity,
    expectedOldCity,
    { addressCity: newCity, updatedAt: new Date() },
    db,
  );
}

export async function updateJobAddressState(
  id: string,
  expectedOldState: string,
  newState: string,
  db: Db = defaultDb,
): Promise<Job> {
  return casUpdateJobField(
    id,
    "Address State",
    jobs.addressState,
    expectedOldState,
    { addressState: newState, updatedAt: new Date() },
    db,
  );
}

export async function updateJobAddressZip(
  id: string,
  expectedOldZip: string,
  newZip: string,
  db: Db = defaultDb,
): Promise<Job> {
  return casUpdateJobField(
    id,
    "Address Zip",
    jobs.addressZip,
    normalizeNullableAddressPart(expectedOldZip),
    { addressZip: normalizeNullableAddressPart(newZip), updatedAt: new Date() },
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
