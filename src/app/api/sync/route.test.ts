import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Route-Handler seam test, following the same mocking pattern as
// src/app/(intake)/jobs/actions.test.ts: mock `auth()` to exercise the
// technician role gate, but run the real query layer against a PGlite
// (real Postgres, WASM) database by mocking "@/db".
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("../../../../auth", () => ({
  auth: authMock,
}));

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/db/test-utils");
  const db = await createTestDb();
  return { db };
});

import { jobs, markets, users } from "@/db/schema";
import { db } from "@/db";
import { POST } from "./route";

function technicianSession(userId: string) {
  return { user: { id: userId, role: "technician" } };
}

function officeStaffSession(userId: string) {
  return { user: { id: userId, role: "office_staff" } };
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/sync", () => {
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

  function validBody(overrides: Record<string, unknown> = {}) {
    return {
      id: randomUUID(),
      jobNumber: `J-${randomUUID()}`,
      date: "2026-01-15",
      addressStreet: "104 E Welwood Dr",
      addressCity: "Savannah",
      addressState: "GA",
      addressZip: "31419",
      fiberCode: "CP",
      fiberFootage: 200,
      boreFootage: 300,
      locate: true,
      directionalBore: false,
      prebury: true,
      techNotes: "All clear",
      ...overrides,
    };
  }

  it("rejects a request with no technician session", async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(postRequest(validBody()));

    expect(response.status).toBe(403);
  });

  it("rejects an office_staff session", async () => {
    authMock.mockResolvedValue(officeStaffSession(technicianId));

    const response = await POST(postRequest(validBody()));

    expect(response.status).toBe(403);
  });

  it("creates a Job on the first sync of a new client-generated id", async () => {
    authMock.mockResolvedValue(technicianSession(technicianId));
    const id = randomUUID();

    const response = await POST(postRequest(validBody({ id })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, created: true, job: { id } });

    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(job.technicianId).toBe(technicianId);

    const [market] = await db.select().from(markets).where(eq(markets.id, job.marketId));
    expect(market.name).toBe("Georgia");
  });

  it("is a no-op success when the same client-generated id is retried with identical data", async () => {
    authMock.mockResolvedValue(technicianSession(technicianId));
    const body = validBody();

    const first = await POST(postRequest(body));
    expect(first.status).toBe(200);
    const firstPayload = await first.json();
    expect(firstPayload).toMatchObject({ ok: true, created: true });

    const second = await POST(postRequest(body));
    expect(second.status).toBe(200);
    const secondPayload = await second.json();
    expect(secondPayload).toMatchObject({ ok: true, created: false, job: { id: body.id } });

    const rows = await db.select().from(jobs).where(eq(jobs.id, body.id));
    expect(rows).toHaveLength(1);
  });

  it("rejects a genuinely conflicting (market_id, job_number) from a different client-generated id", async () => {
    authMock.mockResolvedValue(technicianSession(technicianId));
    const jobNumber = `J-DUP-${randomUUID()}`;

    const first = await POST(postRequest(validBody({ id: randomUUID(), jobNumber })));
    expect(first.status).toBe(200);

    const second = await POST(postRequest(validBody({ id: randomUUID(), jobNumber })));
    const secondPayload = await second.json();

    expect(second.status).toBe(409);
    expect(secondPayload).toMatchObject({ ok: false, error: "duplicate_job_number" });
  });

  it("rejects an id that already exists with different submitted data", async () => {
    authMock.mockResolvedValue(technicianSession(technicianId));
    const id = randomUUID();

    const first = await POST(postRequest(validBody({ id, jobNumber: "J-ORIGINAL" })));
    expect(first.status).toBe(200);

    const second = await POST(
      postRequest(validBody({ id, jobNumber: "J-ORIGINAL", techNotes: "Different notes now" })),
    );
    const secondPayload = await second.json();

    expect(second.status).toBe(409);
    expect(secondPayload).toMatchObject({ ok: false, error: "conflict" });
  });

  it("returns a validation error for a malformed body", async () => {
    authMock.mockResolvedValue(technicianSession(technicianId));

    const response = await POST(postRequest(validBody({ addressStreet: "" })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({ ok: false, error: "validation" });
  });

  it("returns a validation error for a state outside FL/GA", async () => {
    authMock.mockResolvedValue(technicianSession(technicianId));

    const response = await POST(postRequest(validBody({ addressState: "NY" })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({ ok: false, error: "validation" });
  });
});
