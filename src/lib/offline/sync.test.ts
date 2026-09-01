import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineDb, type QueuedJob } from "./db";
import { syncQueuedJobs } from "./sync";

// Exercises the Dexie queue + sync loop against fake-indexeddb (see
// vitest.setup.ts) — a real IndexedDB implementation in Node, not a mock of
// Dexie itself — with global fetch mocked to stand in for the network/the
// api/sync endpoint (that seam is covered for real by
// src/app/api/sync/route.test.ts).
function queuedJob(overrides: Partial<QueuedJob> = {}): QueuedJob {
  return {
    id: randomUUID(),
    jobNumber: `J-${randomUUID()}`,
    date: "2026-01-15",
    addressStreet: "104 E Welwood Dr",
    addressLine2: "",
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
    status: "queued",
    queuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("syncQueuedJobs", () => {
  beforeEach(async () => {
    await offlineDb.queuedJobs.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks a queued Job synced after a successful POST to /api/sync", async () => {
    const job = queuedJob();
    await offlineDb.queuedJobs.add(job);

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const summary = await syncQueuedJobs();

    expect(summary).toEqual({ synced: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sync",
      expect.objectContaining({ method: "POST" }),
    );
    const stored = await offlineDb.queuedJobs.get(job.id);
    expect(stored?.status).toBe("synced");
  });

  it("leaves a Job queued when the sync request fails (network error)", async () => {
    const job = queuedJob();
    await offlineDb.queuedJobs.add(job);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const summary = await syncQueuedJobs();

    expect(summary).toEqual({ synced: 0, failed: 1 });
    const stored = await offlineDb.queuedJobs.get(job.id);
    expect(stored?.status).toBe("queued");
  });

  it("leaves a Job queued when the server rejects the sync", async () => {
    const job = queuedJob();
    await offlineDb.queuedJobs.add(job);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false }), { status: 409 })),
    );

    const summary = await syncQueuedJobs();

    expect(summary).toEqual({ synced: 0, failed: 1 });
    const stored = await offlineDb.queuedJobs.get(job.id);
    expect(stored?.status).toBe("queued");
  });

  it("does not re-sync a Job that's already marked synced", async () => {
    const job = queuedJob({ status: "synced" });
    await offlineDb.queuedJobs.add(job);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const summary = await syncQueuedJobs();

    expect(summary).toEqual({ synced: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
