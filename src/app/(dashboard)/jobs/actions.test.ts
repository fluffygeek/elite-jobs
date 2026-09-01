import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Server-Action seam tests: mock `auth()` (from the root auth.ts) and
// next/navigation's redirect, but exercise the real query layer against a
// PGlite (real Postgres, WASM) database — see src/db/test-utils.ts. Mirrors
// src/app/(dashboard)/markets/actions.test.ts's established pattern.
const { authMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("../../../../auth", () => ({
  auth: authMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/db/test-utils");
  const db = await createTestDb();
  return { db };
});

import { acquireJobLock, createJob } from "@/db/queries/jobs";
import { markets, users } from "@/db/schema";
import { db as testDb } from "@/db";
import { openJobForEdit } from "./actions";

function officeStaffSession(userId: string) {
  return { user: { id: userId, role: "office_staff" } };
}

function technicianSession(userId: string) {
  return { user: { id: userId, role: "technician" } };
}

describe("jobs Server Actions", () => {
  let technicianId: string;
  let staffAId: string;
  let staffBId: string;

  beforeEach(async () => {
    authMock.mockReset();
    redirectMock.mockClear();

    await testDb.insert(markets).values([{ name: "Florida" }, { name: "Georgia" }]);

    const [technician] = await testDb
      .insert(users)
      .values({ email: `tech-${randomUUID()}@example.com`, role: "technician", passwordHash: "hash" })
      .returning();
    technicianId = technician.id;

    const [staffA, staffB] = await testDb
      .insert(users)
      .values([
        { email: `staff-a-${randomUUID()}@example.com`, role: "office_staff", passwordHash: "hash" },
        { email: `staff-b-${randomUUID()}@example.com`, role: "office_staff", passwordHash: "hash" },
      ])
      .returning();
    staffAId = staffA.id;
    staffBId = staffB.id;
  });

  async function seedJob() {
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
        techNotes: "Original note",
      },
      testDb,
    );
  }

  describe("openJobForEdit", () => {
    it("acquires the lock and redirects to the detail page on success", async () => {
      authMock.mockResolvedValue(officeStaffSession(staffAId));
      const job = await seedJob();

      await expect(openJobForEdit(job.id)).rejects.toThrow("NEXT_REDIRECT");

      expect(redirectMock).toHaveBeenCalledWith(`/jobs/${job.id}`);
    });

    it("redirects back to the list naming the holder when the Job is already locked", async () => {
      authMock.mockResolvedValue(officeStaffSession(staffAId));
      const job = await seedJob();
      await acquireJobLock(job.id, staffBId, testDb);

      await expect(openJobForEdit(job.id)).rejects.toThrow("NEXT_REDIRECT");

      const [url] = redirectMock.mock.calls[0];
      expect(url).toMatch(/^\/jobs\?notice=/);
      expect(url).toContain("error=1");
    });

    it("redirects back to the list when the Job doesn't exist", async () => {
      authMock.mockResolvedValue(officeStaffSession(staffAId));

      await expect(openJobForEdit(randomUUID())).rejects.toThrow("NEXT_REDIRECT");

      const [url] = redirectMock.mock.calls[0];
      expect(url).toMatch(/^\/jobs\?notice=/);
      expect(url).toContain("error=1");
    });

    it("rejects a technician session", async () => {
      authMock.mockResolvedValue(technicianSession(technicianId));
      const job = await seedJob();

      await expect(openJobForEdit(job.id)).rejects.toThrow(/office staff only/i);
    });

    it("rejects when there is no session", async () => {
      authMock.mockResolvedValue(null);
      const job = await seedJob();

      await expect(openJobForEdit(job.id)).rejects.toThrow(/office staff only/i);
    });
  });
});
