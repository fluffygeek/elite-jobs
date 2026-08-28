import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Server-Action seam test, following the same mocking pattern as
// src/app/(dashboard)/markets/actions.test.ts: mock `auth()` to exercise the
// technician role gate, but run the real query layer against a PGlite
// (real Postgres, WASM) database by mocking "@/db" (the postgres.js
// connection singleton) rather than the query functions themselves.
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
import { submitJob, type SubmitJobInput } from "./actions";
import { NotAuthorizedError } from "./errors";

function technicianSession(userId: string) {
  return { user: { id: userId, role: "technician" } };
}

function officeStaffSession(userId: string) {
  return { user: { id: userId, role: "office_staff" } };
}

describe("submitJob Server Action", () => {
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

  function validInput(overrides: Partial<SubmitJobInput> = {}): SubmitJobInput {
    return {
      id: randomUUID(),
      marketId,
      jobNumber: `J-${randomUUID()}`,
      date: new Date("2026-01-15T00:00:00Z"),
      address: "104 E Welwood Dr, Savannah, GA 31419, USA",
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

  it("allows a technician session to submit a Job, attributed to that technician", async () => {
    authMock.mockResolvedValue(technicianSession(technicianId));

    const result = await submitJob(validInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.job.jobNumber).toMatch(/^J-/);

      const [job] = await db.select().from(jobs).where(eq(jobs.id, result.job.id));
      expect(job.technicianId).toBe(technicianId);
    }
  });

  it("rejects an office_staff session", async () => {
    authMock.mockResolvedValue(officeStaffSession(technicianId));

    await expect(submitJob(validInput())).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it("rejects when there is no session", async () => {
    authMock.mockResolvedValue(null);

    await expect(submitJob(validInput())).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it("returns a typed duplicate_job_number error for a repeated (market, job_number)", async () => {
    authMock.mockResolvedValue(technicianSession(technicianId));
    const jobNumber = `J-DUP-${randomUUID()}`;

    const first = await submitJob(validInput({ id: randomUUID(), jobNumber }));
    expect(first.ok).toBe(true);

    const second = await submitJob(validInput({ id: randomUUID(), jobNumber }));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBe("duplicate_job_number");
    }
  });

  it("returns a typed validation error for an unparsable address", async () => {
    authMock.mockResolvedValue(technicianSession(technicianId));

    const result = await submitJob(validInput({ address: "not a real address" }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("validation");
    }
  });
});
