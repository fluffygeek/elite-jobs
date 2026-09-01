import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/test-utils";
import {
  acquireJobLock,
  createJob,
  DuplicateJobNumberError,
  getJobById,
  JobLockedError,
  JobNotFoundError,
  listJobs,
  LockNotHeldError,
  releaseJobLock,
  UnsupportedMarketError,
  updateJob,
  type JobUpdatePatch,
} from "@/db/queries/jobs";
import { jobs, markets, users } from "@/db/schema";

describe("createJob persistence", () => {
  let db: TestDb;
  let technicianId: string;
  let staffAId: string;
  let staffBId: string;

  beforeEach(async () => {
    db = await createTestDb();

    const [technician] = await db
      .insert(users)
      .values({ email: "tech@example.com", role: "technician", passwordHash: "hash" })
      .returning();
    technicianId = technician.id;

    const [staffA, staffB] = await db
      .insert(users)
      .values([
        { email: "staff-a@example.com", role: "office_staff", passwordHash: "hash" },
        { email: "staff-b@example.com", role: "office_staff", passwordHash: "hash" },
      ])
      .returning();
    staffAId = staffA.id;
    staffBId = staffB.id;

    // createJob no longer accepts marketId — it derives the Market from
    // addressState (Florida/Georgia only, see issue #33) — so the Markets it
    // can resolve into must actually exist.
    await db.insert(markets).values([{ name: "Florida" }, { name: "Georgia" }]);
  });

  function baseInput(overrides: Partial<Parameters<typeof createJob>[0]> = {}) {
    return {
      id: randomUUID(),
      technicianId,
      jobNumber: "J-100",
      date: new Date("2026-01-15T00:00:00Z"),
      addressStreet: "104 E Welwood Dr",
      addressLine2: undefined,
      addressCity: "Savannah",
      addressState: "GA",
      addressZip: "31419",
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

  function basePatch(overrides: Partial<JobUpdatePatch> = {}): JobUpdatePatch {
    return {
      addressStreet: "104 E Welwood Dr",
      addressLine2: null,
      addressCity: "Savannah",
      addressState: "GA",
      addressZip: "31419",
      fiberCode: "CP",
      fiberFootage: 200,
      boreFootage: 750,
      locate: true,
      directionalBore: true,
      prebury: false,
      techNotes: "Updated note",
      discrepancyFlag: false,
      closedOut: false,
      ...overrides,
    };
  }

  it("persists a Job with the structured address fields and server-derived Market/Bore Code", async () => {
    const job = await createJob(baseInput(), db);

    expect(job.addressStreet).toBe("104 E Welwood Dr");
    expect(job.addressLine2).toBeNull();
    expect(job.addressCity).toBe("Savannah");
    expect(job.addressState).toBe("GA");
    expect(job.addressZip).toBe("31419");
    expect(job.boreCode).toBe("DDB4 DBC1 x 300");
    expect(job.technicianId).toBe(technicianId);
    expect(job.jobNumber).toBe("J-100");
    expect(job.techNotes).toBe("Ran into a fence line");
    expect(job.lockedByUserId).toBeNull();
    expect(job.lockedAt).toBeNull();

    const [market] = await db.select().from(markets).where(eq(markets.id, job.marketId));
    expect(market.name).toBe("Georgia");
  });

  it("round-trips Address Line 2 when provided", async () => {
    const job = await createJob(baseInput({ addressLine2: "Apt 4" }), db);
    expect(job.addressLine2).toBe("Apt 4");
  });

  it("derives the Florida Market from an FL addressState", async () => {
    const job = await createJob(
      baseInput({ id: randomUUID(), jobNumber: "J-FL", addressState: "FL", addressCity: "Tampa" }),
      db,
    );

    const [market] = await db.select().from(markets).where(eq(markets.id, job.marketId));
    expect(market.name).toBe("Florida");
  });

  it("defaults techNotes to an empty string when omitted", async () => {
    const job = await createJob(baseInput({ techNotes: undefined }), db);
    expect(job.techNotes).toBe("");
  });

  it("ignores any client-sent boreCode-shaped fields by always recomputing it", async () => {
    // createJob's input type doesn't even accept a client-sent boreCode —
    // this test documents that it's derived from boreFootage regardless of
    // what else might be smuggled in via a loosely-typed caller (e.g. raw
    // FormData).
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
    await createJob(baseInput({ id: randomUUID(), jobNumber: "J-SHARED" }), db);
    const job = await createJob(
      baseInput({
        id: randomUUID(),
        jobNumber: "J-SHARED",
        addressState: "FL",
        addressCity: "Tampa",
      }),
      db,
    );

    const [market] = await db.select().from(markets).where(eq(markets.id, job.marketId));
    expect(market.name).toBe("Florida");
  });

  it("throws UnsupportedMarketError for a state outside FL/GA", async () => {
    await expect(
      createJob(baseInput({ addressState: "NY" }), db),
    ).rejects.toBeInstanceOf(UnsupportedMarketError);
  });

  describe("listJobs", () => {
    it("returns every Job across every Market, joined with Market name, Technician email, and lock status", async () => {
      await createJob(baseInput({ id: randomUUID(), jobNumber: "J-A" }), db);
      await createJob(
        baseInput({
          id: randomUUID(),
          jobNumber: "J-B",
          addressState: "FL",
          addressCity: "Tampa",
        }),
        db,
      );

      const rows = await listJobs(db);

      expect(rows).toHaveLength(2);
      const marketNames = rows.map((r) => r.marketName).sort();
      expect(marketNames).toEqual(["Florida", "Georgia"]);
      expect(rows.every((r) => r.technicianEmail === "tech@example.com")).toBe(true);
      expect(rows.every((r) => r.lockHolderEmail === null)).toBe(true);
    });

    it("shows the holder's email for an actively locked Job, and null once it's released", async () => {
      const job = await createJob(baseInput(), db);
      await acquireJobLock(job.id, staffAId, db);

      const lockedRows = await listJobs(db);
      const lockedRow = lockedRows.find((r) => r.job.id === job.id);
      expect(lockedRow?.lockHolderEmail).toBe("staff-a@example.com");

      await releaseJobLock(job.id, staffAId, db);

      const unlockedRows = await listJobs(db);
      const unlockedRow = unlockedRows.find((r) => r.job.id === job.id);
      expect(unlockedRow?.lockHolderEmail).toBeNull();
    });
  });

  describe("pessimistic whole-Job locking", () => {
    it("acquires the lock on an unlocked Job", async () => {
      const job = await createJob(baseInput(), db);

      const locked = await acquireJobLock(job.id, staffAId, db);

      expect(locked.lockedByUserId).toBe(staffAId);
      expect(locked.lockedAt).not.toBeNull();
    });

    it("throws JobLockedError naming the holder when someone else already holds an active lock", async () => {
      const job = await createJob(baseInput(), db);
      await acquireJobLock(job.id, staffAId, db);

      let caught: unknown;
      try {
        await acquireJobLock(job.id, staffBId, db);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(JobLockedError);
      expect((caught as InstanceType<typeof JobLockedError>).holderEmail).toBe(
        "staff-a@example.com",
      );
    });

    it("lets the same user re-acquire (refresh) their own still-active lock", async () => {
      const job = await createJob(baseInput(), db);
      const first = await acquireJobLock(job.id, staffAId, db);
      const second = await acquireJobLock(job.id, staffAId, db);

      expect(second.lockedByUserId).toBe(staffAId);
      expect(second.lockedAt!.getTime()).toBeGreaterThanOrEqual(first.lockedAt!.getTime());
    });

    it("allows a 15+ minute stale lock to be acquired by someone else", async () => {
      const job = await createJob(baseInput(), db);
      await acquireJobLock(job.id, staffAId, db);

      // Simulate the lock having gone stale by backdating lockedAt directly —
      // acquireJobLock's expiry check is a lazy, DB-time check
      // (`locked_at < now() - interval '15 minutes'`), so we only need to
      // move the timestamp back, not wait in real time.
      const staleTimestamp = new Date(Date.now() - 16 * 60 * 1000);
      await db.update(jobs).set({ lockedAt: staleTimestamp }).where(eq(jobs.id, job.id));

      const reacquired = await acquireJobLock(job.id, staffBId, db);
      expect(reacquired.lockedByUserId).toBe(staffBId);
    });

    it("throws JobNotFoundError when acquiring a lock on a Job that doesn't exist", async () => {
      await expect(acquireJobLock(randomUUID(), staffAId, db)).rejects.toBeInstanceOf(
        JobNotFoundError,
      );
    });

    it("releases the caller's own lock", async () => {
      const job = await createJob(baseInput(), db);
      await acquireJobLock(job.id, staffAId, db);

      await releaseJobLock(job.id, staffAId, db);

      const after = await getJobById(job.id, db);
      expect(after?.lockedByUserId).toBeNull();
      expect(after?.lockedAt).toBeNull();
    });

    it("no-ops when trying to release a lock held by someone else", async () => {
      const job = await createJob(baseInput(), db);
      await acquireJobLock(job.id, staffAId, db);

      await releaseJobLock(job.id, staffBId, db);

      const after = await getJobById(job.id, db);
      expect(after?.lockedByUserId).toBe(staffAId);
    });

    describe("updateJob", () => {
      it("succeeds when the caller holds the lock, applies the patch, and releases the lock", async () => {
        const job = await createJob(baseInput(), db);
        await acquireJobLock(job.id, staffAId, db);

        const updated = await updateJob(
          job.id,
          basePatch({ techNotes: "Corrected note", boreFootage: 100 }),
          staffAId,
          db,
        );

        expect(updated.techNotes).toBe("Corrected note");
        expect(updated.boreFootage).toBe(100);
        expect(updated.boreCode).toBe("DDB1");
        expect(updated.lockedByUserId).toBeNull();
        expect(updated.lockedAt).toBeNull();
      });

      it("recomputes Bore Code from the patched Bore Footage", async () => {
        const job = await createJob(baseInput({ boreFootage: 100 }), db);
        await acquireJobLock(job.id, staffAId, db);

        const updated = await updateJob(job.id, basePatch({ boreFootage: 600 }), staffAId, db);

        expect(updated.boreCode).toBe("DDB4 DBC1 x 150");
      });

      it("applies Discrepancy Flag and Close-Out as part of the same combined update", async () => {
        const job = await createJob(baseInput(), db);
        await acquireJobLock(job.id, staffAId, db);

        const updated = await updateJob(
          job.id,
          basePatch({ discrepancyFlag: true, closedOut: true }),
          staffAId,
          db,
        );

        expect(updated.discrepancyFlag).toBe(true);
        expect(updated.closedOut).toBe(true);
      });

      it("throws LockNotHeldError when the caller never acquired the lock", async () => {
        const job = await createJob(baseInput(), db);

        await expect(updateJob(job.id, basePatch(), staffAId, db)).rejects.toBeInstanceOf(
          LockNotHeldError,
        );
      });

      it("throws LockNotHeldError when someone else holds the lock", async () => {
        const job = await createJob(baseInput(), db);
        await acquireJobLock(job.id, staffAId, db);

        await expect(updateJob(job.id, basePatch(), staffBId, db)).rejects.toBeInstanceOf(
          LockNotHeldError,
        );
      });

      it("throws LockNotHeldError when the caller's own lock has expired", async () => {
        const job = await createJob(baseInput(), db);
        await acquireJobLock(job.id, staffAId, db);

        const staleTimestamp = new Date(Date.now() - 16 * 60 * 1000);
        await db.update(jobs).set({ lockedAt: staleTimestamp }).where(eq(jobs.id, job.id));

        await expect(updateJob(job.id, basePatch(), staffAId, db)).rejects.toBeInstanceOf(
          LockNotHeldError,
        );
      });

      it("throws JobNotFoundError when the job id doesn't exist", async () => {
        await expect(updateJob(randomUUID(), basePatch(), staffAId, db)).rejects.toBeInstanceOf(
          JobNotFoundError,
        );
      });
    });
  });
});
