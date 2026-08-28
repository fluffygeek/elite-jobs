import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { ConflictingSyncError, DuplicateJobNumberError, syncJob } from "@/db/queries/jobs";
import { UnparsableAddressError } from "@/lib/domain/job-site";
import { submitJobSchema } from "../../(intake)/jobs/schema";

// Plain JSON Route Handler, not a Server Action — the offline sync path is
// invoked from the browser tab's own fetch() (src/lib/offline/sync.ts), not
// from a service worker, but it still needs a real HTTP endpoint per
// AGENTS.md's ground rules: "the offline-sync path (api/sync) is a plain
// JSON Route Handler because service workers need real HTTP endpoints."
//
// Reuses the same validation (submitJobSchema) and role gate as the online
// submitJob Server Action, and the same underlying job-creation logic
// (syncJob wraps createJob) — see src/db/queries/jobs.ts for the
// retried-sync-is-a-no-op vs genuinely-conflicting-job_number distinction.
export async function POST(request: Request) {
  const session = await auth();
  if (session?.user?.role !== "technician") {
    return NextResponse.json(
      { ok: false, error: "not_authorized", message: "Only Technicians can sync Jobs." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "validation", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = submitJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "validation",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      },
      { status: 400 },
    );
  }

  try {
    const { job, created } = await syncJob({
      ...parsed.data,
      technicianId: session.user.id,
    });

    return NextResponse.json({
      ok: true,
      created,
      job: { id: job.id, jobNumber: job.jobNumber },
    });
  } catch (error) {
    if (error instanceof DuplicateJobNumberError) {
      return NextResponse.json(
        { ok: false, error: "duplicate_job_number", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof ConflictingSyncError) {
      return NextResponse.json(
        { ok: false, error: "conflict", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof UnparsableAddressError) {
      return NextResponse.json(
        { ok: false, error: "validation", message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}
