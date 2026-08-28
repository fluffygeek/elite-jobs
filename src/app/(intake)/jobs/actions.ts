"use server";

import { z } from "zod";
import { auth } from "../../../../auth";
import { createJob, DuplicateJobNumberError } from "@/db/queries/jobs";
import { fiberCodeEnum } from "@/db/schema";
import { UnparsableAddressError } from "@/lib/domain/job-site";
import { NotAuthorizedError } from "./errors";

// The Job's UUID is client-generated (crypto.randomUUID() in the browser
// form) rather than server-assigned. This deliberately follows the same
// identity model ADR 0001 establishes for offline submission — jobs.id is
// documented in src/db/schema.ts as "the client-generated UUID from offline
// submission ... never a server-assigned one" — even though this ticket
// (#5) is the online-only path with no offline queue yet. Ticket #6 (offline
// sync) will upsert on this same client-generated id, so generating it
// client-side now means #6 doesn't have to change how the id is produced,
// only add local persistence + retry around the same submit call.
const submitJobSchema = z.object({
  id: z.string().uuid(),
  marketId: z.string().uuid(),
  jobNumber: z.string().trim().min(1, "Job Number is required"),
  date: z.coerce.date(),
  address: z.string().trim().min(1, "Address is required"),
  fiberCode: z.enum(fiberCodeEnum),
  fiberFootage: z.coerce.number().int().min(0),
  boreFootage: z.coerce.number().int().min(0),
  locate: z.coerce.boolean(),
  directionalBore: z.coerce.boolean(),
  prebury: z.coerce.boolean(),
  techNotes: z.string().trim().optional(),
});

export type SubmitJobInput = z.input<typeof submitJobSchema>;

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
