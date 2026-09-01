import { listJobs } from "@/db/queries/jobs";
import { findDuplicateHintIds } from "@/lib/domain/duplicate-hint";
import { formatAddress } from "@/lib/domain/format-address";
import { openJobForEdit } from "./actions";

// Office Staff dashboard: every Job across every Market in one read-only
// summary list (issue #7), plus a lock-status badge and an "Edit" button
// (issue #34) — editing itself, including Discrepancy Flag and Close-Out,
// now happens exclusively in the locked detail view at /jobs/[id]. Plain
// Server Component + <form action>, no client-state library, matching
// src/app/(dashboard)/markets/page.tsx's established pattern.
export const dynamic = "force-dynamic";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const rows = await listJobs();
  const duplicateIds = findDuplicateHintIds(
    rows.map(({ job }) => ({ id: job.id, address: formatAddress(job), date: job.date })),
  );

  return (
    <main>
      <h1>Jobs</h1>

      {notice && <p role={error ? "alert" : "status"}>{notice}</p>}

      <p>
        <a href="/api/export?scope=all">Export all</a>
        {" | "}
        <a href="/api/export?scope=flagged">Export flagged</a>
      </p>

      <table>
        <thead>
          <tr>
            <th>Market</th>
            <th>Job Number</th>
            <th>Date</th>
            <th>Technician</th>
            <th>Address</th>
            <th>Fiber Code</th>
            <th>Fiber Footage</th>
            <th>Bore Footage</th>
            <th>Bore Code</th>
            <th>Locate</th>
            <th>Directional Bore</th>
            <th>Prebury</th>
            <th>Tech Notes</th>
            <th>Discrepancy Flag</th>
            <th>Close-Out</th>
            <th>Lock</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ job, marketName, technicianEmail, lockHolderEmail }) => {
            const isPossibleDuplicate = duplicateIds.has(job.id);
            return (
              <tr key={job.id}>
                <td>{marketName}</td>
                <td>{job.jobNumber}</td>
                <td>{job.date.toISOString().slice(0, 10)}</td>
                <td>{technicianEmail}</td>
                <td>
                  {isPossibleDuplicate && (
                    <span aria-label="Possible duplicate">⚠️ Possible duplicate</span>
                  )}
                  {job.discrepancyFlag && (
                    <span aria-label="Discrepancy flagged">🚩 Discrepancy flagged</span>
                  )}
                  {job.closedOut && <span aria-label="Closed out">✅ Closed out</span>}
                  <p>{formatAddress(job)}</p>
                </td>
                <td>{job.fiberCode}</td>
                <td>{job.fiberFootage}</td>
                <td>{job.boreFootage}</td>
                <td>{job.boreCode}</td>
                <td>{job.locate ? "Yes" : "No"}</td>
                <td>{job.directionalBore ? "Yes" : "No"}</td>
                <td>{job.prebury ? "Yes" : "No"}</td>
                <td>{job.techNotes}</td>
                <td>{job.discrepancyFlag ? "Yes" : "No"}</td>
                <td>{job.closedOut ? "Yes" : "No"}</td>
                <td>
                  {lockHolderEmail ? (
                    <span aria-label="Locked">🔒 Locked by {lockHolderEmail}</span>
                  ) : (
                    <span aria-label="Unlocked">Unlocked</span>
                  )}
                </td>
                <td>
                  <form action={openJobForEdit.bind(null, job.id)}>
                    <button type="submit">Edit</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
