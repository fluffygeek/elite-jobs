import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/test-utils";
import {
  createJob,
  DuplicateJobNumberError,
  FieldConflictError,
  JobNotFoundError,
  listJobs,
  updateJobAddress,
  updateJobBoreFootage,
  updateJobDirectionalBore,
  updateJobFiberFootage,
  updateJobTechNotes,
} from "@/db/queries/jobs";
import { jobs, markets, users } from "@/db/schema";
import { UnparsableAddressError } from "@/lib/domain/job-site";

describe("createJob persistence", () => {
  let db: TestDb;
  let marketId: string;
  let technicianId: string;

  beforeEach(async () => {
    db = await createTestDb();

    const [market] = await db.insert(markets).values({ name: "Live Oak" }).returning();
    marketId = market.id;

    const [technician] = await db
      .insert(users)
      .values({ email: "tech@example.com", role: "technician", passwordHash: "hash" })
      .returning();
    technicianId = technician.id;
  });

  function baseInput(overrides: Partial<Parameters<typeof createJob>[0]> = {}) {
    return {
      id: randomUUID(),
      marketId,
      technicianId,
      jobNumber: "J-100",
      date: new Date("2026-01-15T00:00:00Z"),
      address: "104 E Welwood Dr, Savannah, GA 31419, USA",
      fiberCode: "CP" as const,
      fiberFootage: 200,
      boreFootage: 750,
      locate: true,
      directionalBore: true,
      prebury: false,
      techNotes: "Ran into a fence line",
      ...overrides,
    };
  }

  it("persists a Job with server-derived Job Site and Bore Code", async () => {
    const job = await createJob(baseInput(), db);

    expect(job.jobSiteState).toBe("GA");
    expect(job.jobSiteZip).toBe("31419");
    expect(job.boreCode).toBe("DDB4 DBC1 x 300");
    expect(job.technicianId).toBe(technicianId);
    expect(job.marketId).toBe(marketId);
    expect(job.jobNumber).toBe("J-100");
    expect(job.techNotes).toBe("Ran into a fence line");
  });

  it("defaults techNotes to an empty string when omitted", async () => {
    const job = await createJob(baseInput({ techNotes: undefined }), db);
    expect(job.techNotes).toBe("");
  });

  it("ignores any client-sent jobSite/boreCode-shaped fields by always recomputing them", async () => {
    // createJob's input type doesn't even accept these fields — this test
    // documents that boreCode is derived from boreFootage regardless of what
    // else might be smuggled in via a loosely-typed caller (e.g. raw FormData).
    const job = await createJob(baseInput({ boreFootage: 100 }), db);
    expect(job.boreCode).toBe("DDB1");
  });

  it("rejects a duplicate (market, job_number) with DuplicateJobNumberError", async () => {
    await createJob(baseInput({ id: randomUUID(), jobNumber: "J-DUP" }), db);

    await expect(
      createJob(baseInput({ id: randomUUID(), jobNumber: "J-DUP" }), db),
    ).rejects.toBeInstanceOf(DuplicateJobNumberError);
  });

  it("allows the same job_number in a different Market", async () => {
    const [otherMarket] = await db.insert(markets).values({ name: "Florida" }).returning();

    await createJob(baseInput({ id: randomUUID(), jobNumber: "J-SHARED" }), db);
    const job = await createJob(
      baseInput({ id: randomUUID(), jobNumber: "J-SHARED", marketId: otherMarket.id }),
      db,
    );

    expect(job.marketId).toBe(otherMarket.id);
  });

  it("throws UnparsableAddressError for an address without a trailing state/zip", async () => {
    await expect(
      createJob(baseInput({ address: "Not a real address" }), db),
    ).rejects.toBeInstanceOf(UnparsableAddressError);
  });

  describe("listJobs", () => {
    it("returns every Job across every Market, joined with Market name and Technician email", async () => {
      const [otherMarket] = await db.insert(markets).values({ name: "Florida" }).returning();
      await createJob(baseInput({ id: randomUUID(), jobNumber: "J-A" }), db);
      await createJob(
        baseInput({ id: randomUUID(), jobNumber: "J-B", marketId: otherMarket.id }),
        db,
      );

      const rows = await listJobs(db);

      expect(rows).toHaveLength(2);
      const marketNames = rows.map((r) => r.marketName).sort();
      expect(marketNames).toEqual(["Florida", "Live Oak"]);
      expect(rows.every((r) => r.technicianEmail === "tech@example.com")).toBe(true);
    });
  });

  describe("per-field compare-and-swap updates", () => {
    // This is the money test: two "concurrent" edits to the *same* field
    // (the second using a now-stale expected-old-value) must have the second
    // one rejected, never silently overwriting the first.
    it("rejects a same-field concurrent edit when the expected old value is stale", async () => {
      const job = await createJob(baseInput({ techNotes: "Original note" }), db);

      // "Staff member A" reads the current value and successfully saves.
      const afterA = await updateJobTechNotes(job.id, "Original note", "Staff A's note", db);
      expect(afterA.techNotes).toBe("Staff A's note");

      // "Staff member B" read the value before A's save, so their expected
      // old value is now stale — must be rejected, not silently applied.
      await expect(
        updateJobTechNotes(job.id, "Original note", "Staff B's note", db),
      ).rejects.toBeInstanceOf(FieldConflictError);

      // And A's write must still stand — never clobbered by the rejected attempt.
      const [current] = await db.select().from(jobs).where(eq(jobs.id, job.id));
      expect(current.techNotes).toBe("Staff A's note");
    });

    it("allows two concurrent edits to two different fields on the same Job to both succeed", async () => {
      const job = await createJob(
        baseInput({ address: "104 E Welwood Dr, Savannah, GA 31419, USA", techNotes: "note" }),
        db,
      );

      const addressUpdate = await updateJobAddress(
        job.id,
        "104 E Welwood Dr, Savannah, GA 31419, USA",
        "200 Peachtree St, Atlanta, GA 30303, USA",
        db,
      );
      const notesUpdate = await updateJobTechNotes(job.id, "note", "updated note", db);

      expect(addressUpdate.address).toBe("200 Peachtree St, Atlanta, GA 30303, USA");
      expect(addressUpdate.jobSiteState).toBe("GA");
      expect(addressUpdate.jobSiteZip).toBe("30303");
      expect(notesUpdate.techNotes).toBe("updated note");
      // Neither write clobbered the other's field.
      expect(notesUpdate.address).toBe("200 Peachtree St, Atlanta, GA 30303, USA");
    });

    it("recomputes Bore Code when Bore Footage is updated via compare-and-swap", async () => {
      const job = await createJob(baseInput({ boreFootage: 100 }), db);
      expect(job.boreCode).toBe("DDB1");

      const updated = await updateJobBoreFootage(job.id, 100, 600, db);

      expect(updated.boreFootage).toBe(600);
      expect(updated.boreCode).toBe("DDB4 DBC1 x 150");
    });

    it("throws FieldConflictError (not JobNotFoundError) when the job exists but the field changed", async () => {
      const job = await createJob(baseInput({ fiberFootage: 100 }), db);
      await updateJobFiberFootage(job.id, 100, 150, db);

      await expect(updateJobFiberFootage(job.id, 100, 200, db)).rejects.toBeInstanceOf(
        FieldConflictError,
      );
    });

    it("throws JobNotFoundError (not FieldConflictError) when the job id doesn't exist", async () => {
      await expect(
        updateJobDirectionalBore(randomUUID(), true, false, db),
      ).rejects.toBeInstanceOf(JobNotFoundError);
    });
  });
});
