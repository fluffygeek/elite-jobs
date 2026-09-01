import Link from "next/link";
import { auth } from "../../../../../auth";
import { getJobById, isLockHeldBy } from "@/db/queries/jobs";
import { saveJob, cancelEdit } from "./actions";

// The locked detail/edit view (issue #34) — every field Office Staff can
// correct, including Discrepancy Flag and Close-Out (moved here from the old
// one-click table toggles), lives in one form gated by the whole-Job
// pessimistic lock. Re-verifies on load that the current session still
// actually holds the lock (it could have expired between acquiring it in
// src/app/(dashboard)/jobs/actions.ts's openJobForEdit and this render, or
// under a race) rather than trusting that a successful redirect here still
// implies a valid lock.
export const dynamic = "force-dynamic";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [session, job] = await Promise.all([auth(), getJobById(id)]);

  if (!job) {
    return (
      <main>
        <h1>Job not found</h1>
        <p>
          <Link href="/jobs">Back to Jobs</Link>
        </p>
      </main>
    );
  }

  const lockedToMe =
    session?.user?.role === "office_staff" && isLockHeldBy(job, session.user.id);

  if (!lockedToMe) {
    return (
      <main>
        <h1>This Job is no longer locked to you</h1>
        <p>
          Your lock on this Job may have expired, or someone else is now editing it. Go back to
          the list and click Edit again to reacquire it.
        </p>
        <p>
          <Link href="/jobs">Back to Jobs</Link>
        </p>
      </main>
    );
  }

  const saveJobAction = saveJob.bind(null, id);
  const cancelEditAction = cancelEdit.bind(null, id);

  return (
    <main>
      <h1>Edit Job {job.jobNumber}</h1>

      <form action={saveJobAction}>
        <fieldset>
          <legend>Address</legend>
          <label>
            Street
            <input type="text" name="addressStreet" defaultValue={job.addressStreet} required />
          </label>
          <label>
            Line 2
            <input type="text" name="addressLine2" defaultValue={job.addressLine2 ?? ""} />
          </label>
          <label>
            City
            <input type="text" name="addressCity" defaultValue={job.addressCity} required />
          </label>
          <label>
            State
            <input type="text" name="addressState" defaultValue={job.addressState} required />
          </label>
          <label>
            Zip
            <input type="text" name="addressZip" defaultValue={job.addressZip ?? ""} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Fiber / Bore</legend>
          <label>
            Fiber Code
            <select name="fiberCode" defaultValue={job.fiberCode}>
              <option value="CP">CP</option>
              <option value="DDB">DDB</option>
            </select>
          </label>
          <label>
            Fiber Footage
            <input
              type="number"
              name="fiberFootage"
              defaultValue={job.fiberFootage}
              required
            />
          </label>
          <label>
            Bore Footage
            <input type="number" name="boreFootage" defaultValue={job.boreFootage} required />
          </label>
          <p>Current Bore Code: {job.boreCode}</p>
        </fieldset>

        <fieldset>
          <legend>Site Attributes</legend>
          <label>
            Locate
            <select name="locate" defaultValue={String(job.locate)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label>
            Directional Bore
            <select name="directionalBore" defaultValue={String(job.directionalBore)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label>
            Prebury
            <select name="prebury" defaultValue={String(job.prebury)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Notes</legend>
          <label>
            Tech Notes
            <textarea name="techNotes" defaultValue={job.techNotes} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Office Staff status</legend>
          <label>
            Discrepancy Flag
            <select name="discrepancyFlag" defaultValue={String(job.discrepancyFlag)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label>
            Close-Out
            <select name="closedOut" defaultValue={String(job.closedOut)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
        </fieldset>

        <button type="submit">Save</button>
      </form>

      <form action={cancelEditAction}>
        <button type="submit">Cancel</button>
      </form>
    </main>
  );
}
