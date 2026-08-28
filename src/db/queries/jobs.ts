import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db";
import { jobs, type FiberCode } from "@/db/schema";
import { computeBoreCode } from "@/lib/domain/bore-payment-tier";
import { deriveJobSite } from "@/lib/domain/job-site";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, typeof import("@/db/schema")>;

// Fields a Technician submits from the job intake form. Note what's
// deliberately absent: jobSiteState/jobSiteZip and boreCode are never
// accepted here — they're always server-computed below (see AGENTS.md's
// ground rules and src/db/schema.ts's comments on those columns).
export interface CreateJobInput {
  id: string;
  marketId: string;
  technicianId: string;
  jobNumber: string;
  date: Date;
  address: string;
  fiberCode: FiberCode;
  fiberFootage: number;
  boreFootage: number;
  locate: boolean;
  directionalBore: boolean;
  prebury: boolean;
  techNotes?: string;
}

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
