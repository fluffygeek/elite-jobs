import Dexie, { type Table } from "dexie";
import type { FiberCode } from "@/db/schema";

// Local (IndexedDB) queue for Jobs created by the Technician intake form.
// Mirrors the fields the online submitJob Server Action / api/sync route
// accept, plus a client-side `status` used to drive the sync loop in
// ./sync.ts. `id` is the same client-generated UUID used everywhere else in
// the identity model (ADR 0001) — see new-job-form.tsx.
export interface QueuedJob {
  id: string;
  marketId: string;
  jobNumber: string;
  // Stored as an ISO date string (not a Date) — IndexedDB structured clone
  // handles Dates fine, but a plain string keeps this record trivially
  // JSON-serializable for the fetch() body in ./sync.ts without conversion.
  date: string;
  address: string;
  fiberCode: FiberCode;
  fiberFootage: number;
  boreFootage: number;
  locate: boolean;
  directionalBore: boolean;
  prebury: boolean;
  techNotes: string;
  status: "queued" | "synced";
  queuedAt: string;
}

class OfflineDb extends Dexie {
  queuedJobs!: Table<QueuedJob, string>;

  constructor() {
    super("elite-jobs-offline");
    this.version(1).stores({
      // `id` as the primary key (matches the server's Job id); `status`
      // indexed so the sync loop can cheaply find unsynced rows.
      queuedJobs: "id, status",
    });
  }
}

export const offlineDb = new OfflineDb();
