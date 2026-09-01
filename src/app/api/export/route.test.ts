import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Route-Handler seam test, following the same mocking pattern as
// src/app/api/sync/route.test.ts: mock `auth()` to exercise the office_staff
// role gate, but run the real query layer against a PGlite (real Postgres,
// WASM) database by mocking "@/db".
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("../../../../auth", () => ({
  auth: authMock,
}));

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/db/test-utils");
  const db = await createTestDb();
  return { db };
});

import { createJob, updateJobDiscrepancyFlag } from "@/db/queries/jobs";
import { markets, users } from "@/db/schema";
import { db } from "@/db";
import { GET } from "./route";

function officeStaffSession() {
  return { user: { role: "office_staff" } };
}

function technicianSession() {
  return { user: { role: "technician" } };
}

function getRequest(query: string) {
  return new Request(`http://localhost/api/export${query}`);
}

// Splits CSV text on CRLF row separators into fields per row (naive: fine
// for the rows this test seeds, which don't combine escaping edge cases
// within the same row).
function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split("\r\n")
    .map((line) => line.split(","));
}

describe("GET /api/export", () => {
  let technicianId: string;

  beforeEach(async () => {
    authMock.mockReset();

    // Market is derived server-side from addressState (FL/GA only, see
    // issue #33) rather than submitted — so the Markets it can resolve into
    // must actually exist.
    await db.insert(markets).values([{ name: "Florida" }, { name: "Georgia" }]);

    const [technician] = await db
      .insert(users)
      .values({ email: `tech-${randomUUID()}@example.com`, role: "technician", passwordHash: "hash" })
      .returning();
    technicianId = technician.id;
  });

  async function seedJob(overrides: Record<string, unknown> = {}) {
    return createJob(
      {
        id: randomUUID(),
        technicianId,
        jobNumber: `J-${randomUUID()}`,
        date: new Date("2026-01-15T00:00:00Z"),
        addressStreet: "104 E Welwood Dr",
        addressCity: "Savannah",
        addressState: "GA",
        addressZip: "31419",
        fiberCode: "CP",
        fiberFootage: 200,
        boreFootage: 100,
        locate: true,
        directionalBore: true,
        prebury: false,
        techNotes: "All clear",
        ...overrides,
      },
      db,
    );
  }

  it("rejects a request with no session", async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(getRequest("?scope=all"));

    expect(response.status).toBe(403);
  });

  it("rejects a technician session", async () => {
    authMock.mockResolvedValue(technicianSession());

    const response = await GET(getRequest("?scope=all"));

    expect(response.status).toBe(403);
  });

  it("rejects an invalid scope", async () => {
    authMock.mockResolvedValue(officeStaffSession());

    const response = await GET(getRequest("?scope=bogus"));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({ ok: false, error: "validation" });
  });

  it("rejects a missing scope", async () => {
    authMock.mockResolvedValue(officeStaffSession());

    const response = await GET(getRequest(""));

    expect(response.status).toBe(400);
  });

  it("returns every Job as CSV rows for scope=all", async () => {
    authMock.mockResolvedValue(officeStaffSession());
    await seedJob({ jobNumber: "J-ALL-1" });
    await seedJob({ jobNumber: "J-ALL-2" });

    const response = await GET(getRequest("?scope=all"));
    const text = await response.text();
    const rows = parseCsv(text);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain('filename="jobs-all-');
    // header row + 2 job rows
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([
      "Job Number",
      "Date",
      "Market",
      "Technician",
      "Address",
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
    ]);
    const jobNumbers = rows.slice(1).map((row) => row[0]);
    expect(jobNumbers.sort()).toEqual(["J-ALL-1", "J-ALL-2"]);
  });

  it("composes the structured address fields into one readable Address column", async () => {
    authMock.mockResolvedValue(officeStaffSession());
    await seedJob({
      jobNumber: "J-ADDR",
      addressStreet: "123 Main St",
      addressLine2: "Apt 4",
      addressCity: "Savannah",
      addressState: "GA",
      addressZip: "31401",
    });

    const response = await GET(getRequest("?scope=all"));
    const text = await response.text();

    // The composed address contains commas, so RFC 4180 escaping quotes the
    // whole field — parseCsv's naive comma-split can't reconstruct that, so
    // this checks the raw CSV text instead (same approach the existing
    // comma/quote-escaping tests below use).
    expect(text).toContain('"123 Main St, Apt 4, Savannah, GA 31401"');
  });

  it("returns only flagged Jobs for scope=flagged, excluding non-flagged Jobs", async () => {
    authMock.mockResolvedValue(officeStaffSession());
    const flagged = await seedJob({ jobNumber: "J-FLAGGED" });
    await seedJob({ jobNumber: "J-NOT-FLAGGED" });

    // Discrepancy Flag isn't settable via createJob's input, so flip it via
    // the same compare-and-swap update the dashboard uses.
    await updateJobDiscrepancyFlag(flagged.id, false, true, db);

    const response = await GET(getRequest("?scope=flagged"));
    const text = await response.text();
    const rows = parseCsv(text);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain('filename="jobs-flagged-');
    expect(rows).toHaveLength(2); // header + 1 flagged job
    expect(rows[1][0]).toBe("J-FLAGGED");
    const jobNumbers = rows.slice(1).map((row) => row[0]);
    expect(jobNumbers).not.toContain("J-NOT-FLAGGED");
  });

  it("escapes a Tech Notes value containing a comma", async () => {
    authMock.mockResolvedValue(officeStaffSession());
    await seedJob({ jobNumber: "J-COMMA", techNotes: "Left gate, locked shed" });

    const response = await GET(getRequest("?scope=all"));
    const text = await response.text();

    expect(text).toContain('"Left gate, locked shed"');
  });

  it("escapes a Tech Notes value containing a double quote", async () => {
    authMock.mockResolvedValue(officeStaffSession());
    await seedJob({ jobNumber: "J-QUOTE", techNotes: 'Tech said "all good" on site' });

    const response = await GET(getRequest("?scope=all"));
    const text = await response.text();

    expect(text).toContain('"Tech said ""all good"" on site"');
  });
});
