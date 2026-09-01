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
  UnsupportedMarketError,
  updateJobAddressCity,
  updateJobAddressLine2,
  updateJobAddressState,
  updateJobAddressStreet,
  updateJobAddressZip,
  updateJobBoreFootage,
  updateJobClosedOut,
  updateJobDirectionalBore,
  updateJobDiscrepancyFlag,
  updateJobFiberFootage,
  updateJobTechNotes,
} from "@/db/queries/jobs";
import { jobs, markets, users } from "@/db/schema";

describe("createJob persistence", () => {
  let db: TestDb;
  let technicianId: string;

  beforeEach(async () => {
    db = await createTestDb();

    const [technician] = await db
      .insert(users)
      .values({ email: "tech@example.com", role: "technician", passwordHash: "hash" })
      .returning();
    technicianId = technician.id;

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
    it("returns every Job across every Market, joined with Market name and Technician email", async () => {
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

    it("allows two concurrent edits to two different address fields on the same Job to both succeed", async () => {
      const job = await createJob(
        baseInput({ addressStreet: "104 E Welwood Dr", techNotes: "note" }),
        db,
      );

      const streetUpdate = await updateJobAddressStreet(
        job.id,
        "104 E Welwood Dr",
        "200 Peachtree St",
        db,
      );
      const notesUpdate = await updateJobTechNotes(job.id, "note", "updated note", db);

      expect(streetUpdate.addressStreet).toBe("200 Peachtree St");
      expect(notesUpdate.techNotes).toBe("updated note");
      // Neither write clobbered the other's field.
      expect(notesUpdate.addressStreet).toBe("200 Peachtree St");
    });

    it("updates Address City, State, and Zip independently via compare-and-swap", async () => {
      const job = await createJob(baseInput(), db);

      const afterCity = await updateJobAddressCity(job.id, "Savannah", "Atlanta", db);
      expect(afterCity.addressCity).toBe("Atlanta");

      const afterState = await updateJobAddressState(job.id, "GA", "GA", db);
      expect(afterState.addressState).toBe("GA");

      const afterZip = await updateJobAddressZip(job.id, "31419", "30303", db);
      expect(afterZip.addressZip).toBe("30303");
    });

    it("round-trips Address Line 2 through compare-and-swap, including clearing it back to null", async () => {
      const job = await createJob(baseInput({ addressLine2: undefined }), db);
      expect(job.addressLine2).toBeNull();

      const withLine2 = await updateJobAddressLine2(job.id, "", "Apt 4", db);
      expect(withLine2.addressLine2).toBe("Apt 4");

      const cleared = await updateJobAddressLine2(job.id, "Apt 4", "", db);
      expect(cleared.addressLine2).toBeNull();
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

    it("sets and clears the Discrepancy Flag via compare-and-swap", async () => {
      const job = await createJob(baseInput(), db);
      expect(job.discrepancyFlag).toBe(false);

      const flagged = await updateJobDiscrepancyFlag(job.id, false, true, db);
      expect(flagged.discrepancyFlag).toBe(true);

      const cleared = await updateJobDiscrepancyFlag(job.id, true, false, db);
      expect(cleared.discrepancyFlag).toBe(false);
    });

    it("rejects a concurrent Discrepancy Flag edit when the expected old value is stale", async () => {
      const job = await createJob(baseInput(), db);
      await updateJobDiscrepancyFlag(job.id, false, true, db);

      await expect(
        updateJobDiscrepancyFlag(job.id, false, true, db),
      ).rejects.toBeInstanceOf(FieldConflictError);
    });

    it("sets and clears Close-Out via compare-and-swap", async () => {
      const job = await createJob(baseInput(), db);
      expect(job.closedOut).toBe(false);

      const closedOut = await updateJobClosedOut(job.id, false, true, db);
      expect(closedOut.closedOut).toBe(true);

      const reopened = await updateJobClosedOut(job.id, true, false, db);
      expect(reopened.closedOut).toBe(false);
    });

    it("rejects a concurrent Close-Out edit when the expected old value is stale", async () => {
      const job = await createJob(baseInput(), db);
      await updateJobClosedOut(job.id, false, true, db);

      await expect(updateJobClosedOut(job.id, false, true, db)).rejects.toBeInstanceOf(
        FieldConflictError,
      );
    });
  });
});
