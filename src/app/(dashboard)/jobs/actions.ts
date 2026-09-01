"use server";

import { redirect } from "next/navigation";
import { auth } from "../../../../auth";
import { acquireJobLock, JobLockedError, JobNotFoundError } from "@/db/queries/jobs";
import type { Session } from "next-auth";

// Only Office Staff may edit Jobs — mirrors src/app/(dashboard)/markets/actions.ts's
// role gate. Real credential verification lands in ticket #4; the Server
// Action tests exercise this by mocking `auth()`'s return value.
async function requireOfficeStaffSession(): Promise<Session> {
  const session = await auth();
  if (session?.user?.role !== "office_staff") {
    throw new Error("Forbidden: office staff only");
  }
  return session;
}

/**
 * The single Office Staff entry point for opening a Job for editing (issue
 * #34, replacing the old per-field updateJobFieldAction dispatch). Attempts
 * to acquire the whole-Job pessimistic lock; on success, redirects to the
 * locked detail/edit view. On failure — someone else holds a currently
 * active lock, or the Job no longer exists — redirects back to the list with
 * a message naming who holds it (or that the Job is gone), per the issue's
 * "Acquire flow" design.
 *
 * redirect() itself throws (a Next.js internal control-flow signal), so the
 * acquire attempt is isolated in its own try/catch and every redirect() call
 * happens outside of it — calling redirect() from inside a catch block that
 * also handles other errors would otherwise re-catch it.
 */
export async function openJobForEdit(jobId: string): Promise<void> {
  const session = await requireOfficeStaffSession();

  let failureMessage: string | undefined;
  try {
    await acquireJobLock(jobId, session.user.id);
  } catch (error) {
    if (error instanceof JobLockedError || error instanceof JobNotFoundError) {
      failureMessage = error.message;
    } else {
      throw error;
    }
  }

  if (failureMessage) {
    redirect(`/jobs?notice=${encodeURIComponent(failureMessage)}&error=1`);
  }

  redirect(`/jobs/${jobId}`);
}
