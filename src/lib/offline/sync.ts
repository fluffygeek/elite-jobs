import { offlineDb, type QueuedJob } from "./db";

export interface SyncSummary {
  synced: number;
  failed: number;
}

function toSyncPayload(job: QueuedJob) {
  const {
    id,
    jobNumber,
    date,
    addressStreet,
    addressLine2,
    addressCity,
    addressState,
    addressZip,
    fiberCode,
    fiberFootage,
    boreFootage,
    locate,
    directionalBore,
    prebury,
    techNotes,
  } = job;
  return {
    id,
    jobNumber,
    date,
    addressStreet,
    addressLine2,
    addressCity,
    addressState,
    addressZip,
    fiberCode,
    fiberFootage,
    boreFootage,
    locate,
    directionalBore,
    prebury,
    techNotes,
  };
}

/**
 * Reads every locally-queued (unsynced) Job and POSTs each to /api/sync.
 * A Job that syncs successfully (including a no-op "already synced,
 * identical data" response — see src/db/queries/jobs.ts's syncJob) is marked
 * `synced` locally. A network failure (fetch throws — offline, DNS, etc.) or
 * a server-side rejection leaves the row `queued` for the next sync attempt,
 * so nothing is ever silently dropped.
 *
 * Deliberately not driven by the Background Sync API
 * (`registration.sync.register`) — iOS Safari doesn't support it (see
 * docs/architecture.md). Instead this is called from explicit trigger
 * points: see initSyncTriggers below.
 */
export async function syncQueuedJobs(): Promise<SyncSummary> {
  const queued = await offlineDb.queuedJobs.where("status").equals("queued").toArray();

  let synced = 0;
  let failed = 0;

  for (const job of queued) {
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSyncPayload(job)),
      });

      if (response.ok) {
        await offlineDb.queuedJobs.update(job.id, { status: "synced" });
        synced++;
      } else {
        // Server rejected it (validation, a genuine job_number conflict, an
        // unexpected data mismatch on retry, etc.) — leave it queued rather
        // than lose it. There's no client-side remediation available for
        // these cases in this ticket's scope; a future pass could surface
        // per-job sync errors to the Technician.
        failed++;
      }
    } catch {
      // Network error — offline, request aborted, etc. Leave queued.
      failed++;
    }
  }

  return { synced, failed };
}

let triggersInitialized = false;

/**
 * Wires up the three sync trigger points issue #6 asks for: on load, on the
 * browser's `online` event, and periodically while the tab is foregrounded.
 * Safe to call more than once (e.g. from multiple mounted components) — only
 * the first call registers listeners.
 */
export function initSyncTriggers(intervalMs = 30_000): void {
  if (triggersInitialized || typeof window === "undefined") {
    return;
  }
  triggersInitialized = true;

  void syncQueuedJobs();

  window.addEventListener("online", () => {
    void syncQueuedJobs();
  });

  setInterval(() => {
    if (document.visibilityState === "visible") {
      void syncQueuedJobs();
    }
  }, intervalMs);
}
