import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Server-Action seam tests: mock `auth()` (from the root auth.ts) to exercise
// the office_staff role gate, but exercise the real query layer against a
// PGlite (real Postgres, WASM) database — see src/db/test-utils.ts. Mirrors
// src/app/(dashboard)/markets/actions.test.ts's established pattern.
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("../../../../auth", () => ({
  auth: authMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/db/test-utils");
  const db = await createTestDb();
  return { db };
});

import { createJob } from "@/db/queries/jobs";
import { markets, users } from "@/db/schema";
import { db as testDb } from "@/db";
import { updateJobFieldAction } from "./actions";

function officeStaffSession() {
  return { user: { role: "office_staff" } };
}

function technicianSession() {
  return { user: { role: "technician" } };
}

describe("jobs Server Actions", () => {
  let marketId: string;
  let technicianId: string;

  beforeEach(async () => {
    authMock.mockReset();

    const [market] = await testDb.insert(markets).values({ name: "Live Oak" }).returning();
    marketId = market.id;

    const [technician] = await testDb
      .insert(users)
      .values({ email: `tech-${randomUUID()}@example.com`, role: "technician", passwordHash: "hash" })
      .returning();
    technicianId = technician.id;
  });

  async function seedJob() {
    return createJob(
      {
        id: randomUUID(),
        marketId,
        technicianId,
        jobNumber: "J-100",
        date: new Date("2026-01-15T00:00:00Z"),
        address: "104 E Welwood Dr, Savannah, GA 31419, USA",
        fiberCode: "CP",
        fiberFootage: 200,
        boreFootage: 100,
        locate: true,
        directionalBore: true,
        prebury: false,
        techNotes: "Original note",
      },
      testDb,
    );
  }

  it("allows an office_staff session to correct a field", async () => {
    authMock.mockResolvedValue(officeStaffSession());
    const job = await seedJob();

    const result = await updateJobFieldAction(job.id, "techNotes", "Original note", "Fixed note");

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.job.techNotes).toBe("Fixed note");
    }
  });

  it("rejects a technician session", async () => {
    authMock.mockResolvedValue(technicianSession());
    const job = await seedJob();

    await expect(
      updateJobFieldAction(job.id, "techNotes", "Original note", "Should not apply"),
    ).rejects.toThrow(/office staff only/i);
  });

  it("rejects when there is no session", async () => {
    authMock.mockResolvedValue(null);
    const job = await seedJob();

    await expect(
      updateJobFieldAction(job.id, "techNotes", "Original note", "Should not apply"),
    ).rejects.toThrow(/office staff only/i);
  });

  it("returns a conflict result (not a thrown error) when the expected old value is stale", async () => {
    authMock.mockResolvedValue(officeStaffSession());
    const job = await seedJob();

    await updateJobFieldAction(job.id, "techNotes", "Original note", "Staff A's note");
    const second = await updateJobFieldAction(job.id, "techNotes", "Original note", "Staff B's note");

    expect(second.status).toBe("conflict");
  });

  it("allows two sequential edits to different fields on the same Job to both succeed", async () => {
    authMock.mockResolvedValue(officeStaffSession());
    const job = await seedJob();

    const addressResult = await updateJobFieldAction(
      job.id,
      "address",
      "104 E Welwood Dr, Savannah, GA 31419, USA",
      "200 Peachtree St, Atlanta, GA 30303, USA",
    );
    const notesResult = await updateJobFieldAction(
      job.id,
      "techNotes",
      "Original note",
      "Updated note",
    );

    expect(addressResult.status).toBe("success");
    expect(notesResult.status).toBe("success");
  });

  it("returns a not_found result for a job id that doesn't exist", async () => {
    authMock.mockResolvedValue(officeStaffSession());

    const result = await updateJobFieldAction(randomUUID(), "techNotes", "anything", "new");

    expect(result.status).toBe("not_found");
  });
});
