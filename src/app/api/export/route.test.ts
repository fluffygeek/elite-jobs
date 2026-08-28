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
  let marketId: string;
  let technicianId: string;

  beforeEach(async () => {
    authMock.mockReset();

    const [market] = await db.insert(markets).values({ name: "Live Oak" }).returning();
    marketId = market.id;

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
        marketId,
        technicianId,
        jobNumber: `J-${randomUUID()}`,
        date: new Date("2026-01-15T00:00:00Z"),
        address: "104 E Welwood Dr, Savannah, GA 31419, USA",
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
    ]);
    const jobNumbers = rows.slice(1).map((row) => row[0]);
    expect(jobNumbers.sort()).toEqual(["J-ALL-1", "J-ALL-2"]);
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
