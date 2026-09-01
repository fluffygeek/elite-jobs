import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Server-Action seam tests: mock `auth()` and next/navigation's redirect,
// exercise the real query layer against a PGlite database. Mirrors
// src/app/(dashboard)/jobs/actions.test.ts's pattern, one directory deeper.
const { authMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("../../../../../auth", () => ({
  auth: authMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/db/test-utils");
  const db = await createTestDb();
  return { db };
});

import { acquireJobLock, createJob, getJobById } from "@/db/queries/jobs";
import { markets, users } from "@/db/schema";
import { db as testDb } from "@/db";
import { cancelEdit, saveJob } from "./actions";

function officeStaffSession(userId: string) {
  return { user: { id: userId, role: "office_staff" } };
}

function technicianSession(userId: string) {
  return { user: { id: userId, role: "technician" } };
}

function validFormData(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values: Record<string, string> = {
    addressStreet: "104 E Welwood Dr",
    addressLine2: "",
    addressCity: "Savannah",
    addressState: "GA",
    addressZip: "31419",
    fiberCode: "CP",
    fiberFootage: "200",
    boreFootage: "100",
    locate: "true",
    directionalBore: "true",
    prebury: "false",
    techNotes: "Updated note",
    discrepancyFlag: "false",
    closedOut: "false",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
}

describe("jobs/[id] Server Actions", () => {
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

  describe("saveJob", () => {
    it("applies the patch and redirects to the list when the caller holds the lock", async () => {
      authMock.mockResolvedValue(officeStaffSession(staffAId));
      const job = await seedJob();
      await acquireJobLock(job.id, staffAId, testDb);

      await expect(
        saveJob(job.id, validFormData({ techNotes: "Corrected note" })),
      ).rejects.toThrow("NEXT_REDIRECT");

      const updated = await getJobById(job.id, testDb);
      expect(updated?.techNotes).toBe("Corrected note");
      expect(updated?.lockedByUserId).toBeNull();

      const [url] = redirectMock.mock.calls[0];
      expect(url).toMatch(/^\/jobs\?notice=/);
    });

    it("applies Discrepancy Flag and Close-Out from the same form", async () => {
      authMock.mockResolvedValue(officeStaffSession(staffAId));
      const job = await seedJob();
      await acquireJobLock(job.id, staffAId, testDb);

      await expect(
        saveJob(job.id, validFormData({ discrepancyFlag: "true", closedOut: "true" })),
      ).rejects.toThrow("NEXT_REDIRECT");

      const updated = await getJobById(job.id, testDb);
      expect(updated?.discrepancyFlag).toBe(true);
      expect(updated?.closedOut).toBe(true);
    });

    it("redirects to the list with an error notice when the caller doesn't hold the lock", async () => {
      authMock.mockResolvedValue(officeStaffSession(staffBId));
      const job = await seedJob();
      await acquireJobLock(job.id, staffAId, testDb);

      await expect(saveJob(job.id, validFormData())).rejects.toThrow("NEXT_REDIRECT");

      const [url] = redirectMock.mock.calls[0];
      expect(url).toMatch(/^\/jobs\?notice=/);
      expect(url).toContain("error=1");

      const untouched = await getJobById(job.id, testDb);
      expect(untouched?.techNotes).toBe("Original note");
    });

    it("rejects a technician session", async () => {
      authMock.mockResolvedValue(technicianSession(technicianId));
      const job = await seedJob();

      await expect(saveJob(job.id, validFormData())).rejects.toThrow(/office staff only/i);
    });

    it("rejects when there is no session", async () => {
      authMock.mockResolvedValue(null);
      const job = await seedJob();

      await expect(saveJob(job.id, validFormData())).rejects.toThrow(/office staff only/i);
    });
  });

  describe("cancelEdit", () => {
    it("releases the lock and redirects to the list", async () => {
      authMock.mockResolvedValue(officeStaffSession(staffAId));
      const job = await seedJob();
      await acquireJobLock(job.id, staffAId, testDb);

      await expect(cancelEdit(job.id)).rejects.toThrow("NEXT_REDIRECT");

      const after = await getJobById(job.id, testDb);
      expect(after?.lockedByUserId).toBeNull();
      expect(redirectMock).toHaveBeenCalledWith("/jobs");
    });

    it("rejects a technician session", async () => {
      authMock.mockResolvedValue(technicianSession(technicianId));
      const job = await seedJob();

      await expect(cancelEdit(job.id)).rejects.toThrow(/office staff only/i);
    });

    it("rejects when there is no session", async () => {
      authMock.mockResolvedValue(null);
      const job = await seedJob();

      await expect(cancelEdit(job.id)).rejects.toThrow(/office staff only/i);
    });
  });
});
