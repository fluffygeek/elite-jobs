import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "../../../../auth";
import { listJobs, type JobListRow } from "@/db/queries/jobs";

// Plain JSON... well, plain CSV Route Handler — per docs/architecture.md's
// already-specified contract (`GET /api/export?scope=all|flagged`) and
// AGENTS.md's architecture map ("Route Handler(s) streaming CSV on demand").
// A Route Handler rather than a Server Action because this returns a
// non-HTML response (a file download) driven by a plain `<a href>` on the
// dashboard, not a form submission — Server Actions can't produce that.
//
// No intermediate file/object storage: the CSV is built as a string in
// memory from the query result and returned directly as the Response body.
// Job counts for this MVP are small enough that this is fine; if that ever
// stops being true, a real streaming Response body would be the next step,
// not disk/blob storage (see docs/architecture.md: "No file/object storage
// needed").

const exportQuerySchema = z.object({
  scope: z.enum(["all", "flagged"], {
    message: 'scope must be "all" or "flagged"',
  }),
});

// RFC 4180 field escaping: a field is wrapped in double quotes if it
// contains a comma, a double quote, or a newline, and any double quote
// inside it is doubled. Hand-rolled rather than pulling in a CSV library —
// this is the entire scope of what CSV generation needs here (Tech Notes is
// the only free-text field, so it's the only one that can trigger this),
// and it's directly unit-tested via route.test.ts rather than trusted
// on faith.
function toCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvRow(fields: string[]): string {
  return fields.map(toCsvField).join(",");
}

const CSV_HEADERS = [
  "Job Number",
  "Date",
  "Market",
  "Technician",
  "Address",
  "Job Site",
  "Fiber Code",
  "Fiber Footage",
  "Bore Footage",
  "Bore Code",
  "Locate",
  "Directional Bore",
  "Prebury",
  "Tech Notes",
  "Discrepancy Flag",
  "Closed-Out",
];

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function rowToFields({ job, marketName, technicianEmail }: JobListRow): string[] {
  return [
    job.jobNumber,
    job.date.toISOString().slice(0, 10),
    marketName,
    technicianEmail,
    job.address,
    `${job.jobSiteState} ${job.jobSiteZip}`,
    job.fiberCode,
    String(job.fiberFootage),
    String(job.boreFootage),
    job.boreCode,
    yesNo(job.locate),
    yesNo(job.directionalBore),
    yesNo(job.prebury),
    job.techNotes,
    yesNo(job.discrepancyFlag),
    yesNo(job.closedOut),
  ];
}

function buildCsv(rows: JobListRow[]): string {
  const lines = [toCsvRow(CSV_HEADERS), ...rows.map((row) => toCsvRow(rowToFields(row)))];
  // CRLF per RFC 4180; trailing newline after the last row.
  return lines.join("\r\n") + "\r\n";
}

export async function GET(request: Request) {
  const session = await auth();
  if (session?.user?.role !== "office_staff") {
    return NextResponse.json(
      { ok: false, error: "not_authorized", message: "Only Office Staff can export Jobs." },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const parsed = exportQuerySchema.safeParse({ scope: url.searchParams.get("scope") ?? undefined });
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

  const { scope } = parsed.data;
  const rows = await listJobs();
  const filteredRows = scope === "flagged" ? rows.filter(({ job }) => job.discrepancyFlag) : rows;

  const csv = buildCsv(filteredRows);
  const today = new Date().toISOString().slice(0, 10);
  const filename = `jobs-${scope}-${today}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
