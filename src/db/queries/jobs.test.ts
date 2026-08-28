import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createJob, DuplicateJobNumberError } from "@/db/queries/jobs";
import { markets, users } from "@/db/schema";
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
});
