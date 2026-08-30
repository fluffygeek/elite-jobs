import { listJobs } from "@/db/queries/jobs";
import { findDuplicateHintIds } from "@/lib/domain/duplicate-hint";
import type { EditableJobField } from "./actions";
import { submitFieldEdit } from "./edit-field";

// Office Staff dashboard: every Job across every Market in one list (issue
// #7). Plain Server Component + <form action> per editable field, no
// client-state library — matches src/app/(dashboard)/markets/page.tsx's
// established pattern. Editing prioritizes the compare-and-swap mechanism
// being real and conflicts being clearly surfaced over visual polish (see
// issue #7's brief). Value-parsing and dispatch for field edits live in
// ./edit-field.ts (issue #24) — this file only renders.
export const dynamic = "force-dynamic";

function TextFieldForm({
  jobId,
  field,
  value,
}: {
  jobId: string;
  field: EditableJobField;
  value: string;
}) {
  return (
    <form action={submitFieldEdit.bind(null, jobId, field, value)}>
      <input type="text" name="newValue" defaultValue={value} />
      <button type="submit">Save</button>
    </form>
  );
}

function NumberFieldForm({
  jobId,
  field,
  value,
}: {
  jobId: string;
  field: EditableJobField;
  value: number;
}) {
  return (
    <form action={submitFieldEdit.bind(null, jobId, field, String(value))}>
      <input type="number" name="newValue" defaultValue={value} />
      <button type="submit">Save</button>
    </form>
  );
}

function BooleanFieldForm({
  jobId,
  field,
  value,
}: {
  jobId: string;
  field: EditableJobField;
  value: boolean;
}) {
  return (
    <form action={submitFieldEdit.bind(null, jobId, field, String(value))}>
      <select name="newValue" defaultValue={String(value)}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
      <button type="submit">Save</button>
    </form>
  );
}

function FiberCodeFieldForm({
  jobId,
  value,
}: {
  jobId: string;
  value: string;
}) {
  return (
    <form action={submitFieldEdit.bind(null, jobId, "fiberCode", value)}>
      <select name="newValue" defaultValue={value}>
        <option value="CP">CP</option>
        <option value="DDB">DDB</option>
      </select>
      <button type="submit">Save</button>
    </form>
  );
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const rows = await listJobs();
  const duplicateIds = findDuplicateHintIds(
    rows.map(({ job }) => ({ id: job.id, address: job.address, date: job.date })),
  );

  return (
    <main>
      <h1>Jobs</h1>

      {notice && (
        <p role={error ? "alert" : "status"}>{notice}</p>
      )}

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
          </tr>
        </thead>
        <tbody>
          {rows.map(({ job, marketName, technicianEmail }) => {
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
                  <TextFieldForm jobId={job.id} field="address" value={job.address} />
                </td>
                <td>
                  <FiberCodeFieldForm jobId={job.id} value={job.fiberCode} />
                </td>
                <td>
                  <NumberFieldForm
                    jobId={job.id}
                    field="fiberFootage"
                    value={job.fiberFootage}
                  />
                </td>
                <td>
                  <NumberFieldForm
                    jobId={job.id}
                    field="boreFootage"
                    value={job.boreFootage}
                  />
                </td>
                <td>{job.boreCode}</td>
                <td>
                  <BooleanFieldForm jobId={job.id} field="locate" value={job.locate} />
                </td>
                <td>
                  <BooleanFieldForm
                    jobId={job.id}
                    field="directionalBore"
                    value={job.directionalBore}
                  />
                </td>
                <td>
                  <BooleanFieldForm jobId={job.id} field="prebury" value={job.prebury} />
                </td>
                <td>
                  <TextFieldForm jobId={job.id} field="techNotes" value={job.techNotes} />
                </td>
                <td>
                  <BooleanFieldForm
                    jobId={job.id}
                    field="discrepancyFlag"
                    value={job.discrepancyFlag}
                  />
                </td>
                <td>
                  <BooleanFieldForm jobId={job.id} field="closedOut" value={job.closedOut} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
