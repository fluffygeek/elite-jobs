"use server";

import { auth } from "../../../../auth";
import { createJob, DuplicateJobNumberError } from "@/db/queries/jobs";
import { UnparsableAddressError } from "@/lib/domain/job-site";
import { NotAuthorizedError } from "./errors";
import { submitJobSchema, type SubmitJobInput } from "./schema";

export type { SubmitJobInput };

export type SubmitJobResult =
  | { ok: true; job: { id: string; jobNumber: string } }
  | { ok: false; error: "validation" | "duplicate_job_number"; message: string };

/**
 * Submits a Job from the Technician intake form. Requires an authenticated
 * technician-role session (anyone else is rejected outright, thrown as
 * NotAuthorizedError). Input validation failures and the
 * (market, job_number) duplicate-constraint rejection are returned as a
 * typed result instead of thrown, so the form can render them inline rather
 * than treating them as unexpected errors.
 */
export async function submitJob(input: SubmitJobInput): Promise<SubmitJobResult> {
  const session = await auth();
  if (session?.user?.role !== "technician") {
    throw new NotAuthorizedError();
  }

  const parsed = submitJobSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation",
      message: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }

  try {
    const job = await createJob({
      ...parsed.data,
      technicianId: session.user.id,
    });

    return { ok: true, job: { id: job.id, jobNumber: job.jobNumber } };
  } catch (error) {
    if (error instanceof DuplicateJobNumberError) {
      return { ok: false, error: "duplicate_job_number", message: error.message };
    }
    if (error instanceof UnparsableAddressError) {
      return { ok: false, error: "validation", message: error.message };
    }
    throw error;
  }
}
