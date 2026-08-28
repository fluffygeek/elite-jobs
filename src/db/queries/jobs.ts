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
