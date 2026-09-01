import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { PgDatabase } from "drizzle-orm/pg-core";
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

export class JobNotFoundError extends Error {
  constructor(id: string) {
    super(`Job not found: ${id}`);
    this.name = "JobNotFoundError";
  }
}

export async function getJobById(id: string, db: Db = defaultDb): Promise<Job | null> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return job ?? null;
}

// Office Staff dashboard reads Jobs across every Market in one list (issue
// #7's core view). Joins in Market name, Technician email, and (issue #34)
// the current lock holder's email for display — there's nowhere else the
// dashboard can get any of those without a second round-trip per row.
export interface JobListRow {
  job: Job;
  marketName: string;
  technicianEmail: string;
  // Null when the Job is unlocked, or when a previous lock has gone stale
  // (see isLockActive below) — the list treats a stale lock exactly like no
  // lock at all, so staff aren't told a Job is locked by someone who
  // effectively no longer holds it.
  lockHolderEmail: string | null;
}

export async function listJobs(db: Db = defaultDb): Promise<JobListRow[]> {
  const lockHolders = alias(users, "lock_holders");

  const rows = await db
    .select({
      job: jobs,
      marketName: markets.name,
      technicianEmail: users.email,
      lockHolderEmail: lockHolders.email,
    })
    .from(jobs)
    .innerJoin(markets, eq(jobs.marketId, markets.id))
    .innerJoin(users, eq(jobs.technicianId, users.id))
    .leftJoin(lockHolders, eq(jobs.lockedByUserId, lockHolders.id))
    .orderBy(jobs.date);

  return rows.map((row) => ({
    ...row,
    lockHolderEmail: isLockActive(row.job) ? row.lockHolderEmail : null,
  }));
}

// --- Pessimistic whole-Job locking -----------------------------------------
//
// Replaces the old per-field compare-and-swap mechanism (issue #34, reversing
// issue #1/#7/#8/#24/#25's approach — see
// docs/adr/0002-pessimistic-locking-for-job-edits.md). Office Staff now edit
// a Job by acquiring an exclusive lock on the *whole record* (opening the
// detail view), making every change in one save, and releasing the lock —
// rather than each field independently guarding its own compare-and-swap.
//
// A lock is `lockedByUserId` + `lockedAt`, both null when unlocked. It
// auto-expires after 15 minutes of inactivity — checked lazily at
// acquire-time (`locked_at < now() - 15 minutes` counts as unlocked), no
// background cron needed.

const LOCK_TTL_MS = 15 * 60 * 1000;

function isLockActive(job: Pick<Job, "lockedAt">): boolean {
  return job.lockedAt !== null && Date.now() - job.lockedAt.getTime() < LOCK_TTL_MS;
}

// True only when `userId` holds a currently-active lock on `job` — used by
// the detail page (src/app/(dashboard)/jobs/[id]/page.tsx) to re-verify on
// load that the session that acquired the lock still actually holds it
// (their own lock could have expired between acquiring and loading, or under
// a race), and by updateJob below for the same check server-side.
export function isLockHeldBy(job: Pick<Job, "lockedByUserId" | "lockedAt">, userId: string): boolean {
  return job.lockedByUserId === userId && isLockActive(job);
}

// Thrown by acquireJobLock when the conditional update affects zero rows and
// the Job still exists — i.e. someone else holds a currently-active lock.
// Carries the holder's email so the UI can name them (issue #34's "sees who
// holds it" acceptance criterion).
export class JobLockedError extends Error {
  constructor(public readonly holderEmail: string) {
    super(`This Job is currently locked by ${holderEmail}.`);
    this.name = "JobLockedError";
  }
}

/**
 * Attempts to acquire the whole-Job lock for `userId`. An atomic conditional
 * `UPDATE ... WHERE id = ? AND (unlocked OR stale OR already held by ?)`,
 * checked via affected-row count — the same compare-and-swap *pattern* the
 * old per-field code used for fields, just applied to the lock itself, since
 * acquiring a lock has exactly the same "two people race for it" problem a
 * field update did. Re-acquiring your own still-active lock succeeds and
 * refreshes `lockedAt` (idempotent re-entry, e.g. a reloaded detail page).
 *
 * Zero rows affected is ambiguous on its own (job doesn't exist vs. someone
 * else holds a valid lock) — resolved with a follow-up read, same as the old
 * FieldConflictError/JobNotFoundError disambiguation.
 */
export async function acquireJobLock(jobId: string, userId: string, db: Db = defaultDb): Promise<Job> {
  const [updated] = await db
    .update(jobs)
    .set({ lockedByUserId: userId, lockedAt: new Date() })
    .where(
      and(
        eq(jobs.id, jobId),
        or(
          isNull(jobs.lockedByUserId),
          lt(jobs.lockedAt, sql`now() - interval '15 minutes'`),
          eq(jobs.lockedByUserId, userId),
        ),
      ),
    )
    .returning();

  if (updated) {
    return updated;
  }

  const [existing] = await db
    .select({ job: jobs, holderEmail: users.email })
    .from(jobs)
    .leftJoin(users, eq(jobs.lockedByUserId, users.id))
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!existing) {
    throw new JobNotFoundError(jobId);
  }
  throw new JobLockedError(existing.holderEmail ?? "another Office Staff member");
}

/**
 * Releases the whole-Job lock, but only if `userId` currently holds it — a
 * conditional update, not a plain clear, so a request to release someone
 * else's lock (a stale client, a race) silently no-ops rather than stealing
 * or destroying it. Called on both explicit Cancel and after a successful
 * Save (see src/app/(dashboard)/jobs/[id]/actions.ts).
 */
export async function releaseJobLock(jobId: string, userId: string, db: Db = defaultDb): Promise<void> {
  await db
    .update(jobs)
    .set({ lockedByUserId: null, lockedAt: null })
    .where(and(eq(jobs.id, jobId), eq(jobs.lockedByUserId, userId)));
}

// Thrown by updateJob when `holderUserId` doesn't currently hold an active
// lock on the Job — either it was never acquired, someone else holds it, or
// it expired between acquiring and saving.
export class LockNotHeldError extends Error {
  constructor(id: string) {
    super(`You no longer hold the lock for Job ${id} — it may have expired.`);
    this.name = "LockNotHeldError";
  }
}

// The full set of fields Office Staff can correct from the locked detail
// view — everything the old per-field CAS updaters covered, applied in one
// combined update. `addressLine2`/`addressZip` are nullable (an empty string
// from the form means "no value"); `techNotes` is always a string, never
// undefined.
export interface JobUpdatePatch {
  addressStreet: string;
  addressLine2: string | null;
  addressCity: string;
  addressState: string;
  addressZip: string | null;
  fiberCode: FiberCode;
  fiberFootage: number;
  boreFootage: number;
  locate: boolean;
  directionalBore: boolean;
  prebury: boolean;
  techNotes: string;
  discrepancyFlag: boolean;
  closedOut: boolean;
}

/**
 * Applies a full edit to a Job in one combined update — the whole-Job
 * counterpart to the old per-field CAS updaters, gated by the pessimistic
 * lock rather than a per-field expected-old-value. Verifies `holderUserId`
 * holds a currently-active lock (throws LockNotHeldError otherwise),
 * recomputes Bore Code from the submitted Bore Footage (AGENTS.md's "Bore
 * Code is computed, never client-trusted" ground rule still applies), writes
 * every field in one `UPDATE`, and releases the lock as part of the same
 * call — a save always ends with the Job unlocked again.
 *
 * The lock check happens twice: once as a friendly read to produce a clear
 * error, and again as the actual `WHERE lockedByUserId = ?` guard on the
 * write itself, which is what actually protects against the lock being
 * released or stolen in the gap between the two (the same "don't trust a
 * read-then-write without a real DB-level guard" principle the old CAS code
 * followed).
 */
export async function updateJob(
  jobId: string,
  patch: JobUpdatePatch,
  holderUserId: string,
  db: Db = defaultDb,
): Promise<Job> {
  const existing = await getJobById(jobId, db);
  if (!existing) {
    throw new JobNotFoundError(jobId);
  }
  if (!isLockHeldBy(existing, holderUserId)) {
    throw new LockNotHeldError(jobId);
  }

  const boreCode = computeBoreCode(patch.boreFootage);

  const [updated] = await db
    .update(jobs)
    .set({
      addressStreet: patch.addressStreet,
      addressLine2: patch.addressLine2,
      addressCity: patch.addressCity,
      addressState: patch.addressState,
      addressZip: patch.addressZip,
      fiberCode: patch.fiberCode,
      fiberFootage: patch.fiberFootage,
      boreFootage: patch.boreFootage,
      boreCode,
      locate: patch.locate,
      directionalBore: patch.directionalBore,
      prebury: patch.prebury,
      techNotes: patch.techNotes,
      discrepancyFlag: patch.discrepancyFlag,
      closedOut: patch.closedOut,
      updatedAt: new Date(),
      lockedByUserId: null,
      lockedAt: null,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.lockedByUserId, holderUserId)))
    .returning();

  if (!updated) {
    // The lock was released or stolen between the check above and this
    // write — a genuine race, not just an unfriendly error message.
    throw new LockNotHeldError(jobId);
  }

  return updated;
}
