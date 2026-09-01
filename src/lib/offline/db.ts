import Dexie, { type Table } from "dexie";
import type { TechnicianWritableJobFields } from "@/lib/domain/job-fields";

// Local (IndexedDB) queue for Jobs created by the Technician intake form.
// Derives from the canonical Job schema's technician-writable subset (see
// src/lib/domain/job-fields.ts) — the same fields the online submitJob
// Server Action / api/sync route accept — plus a client-side `status` used
// to drive the sync loop in ./sync.ts. `id` is the same client-generated
// UUID used everywhere else in the identity model (ADR 0001) — see
// new-job-form.tsx. There is no `marketId` here (nor anywhere in
// TechnicianWritableJobFields) — Market is derived server-side from
// `addressState` at sync time (see src/db/queries/jobs.ts's createJob).
//
// Three deliberate divergences from the canonical shape, all kept on purpose
// rather than "fixed":
// - `date` is a string, not a Date — IndexedDB structured clone handles
//   Dates fine, but a plain string keeps this record trivially
//   JSON-serializable for the fetch() body in ./sync.ts without conversion.
// - `techNotes` is required, not optional — unlike the canonical schema
//   (where it's optional because createJob's `input.techNotes ?? ""`
//   defaulting handles a caller that omits it entirely, e.g. some tests call
//   createJob directly). new-job-form.tsx always writes a string here
//   (`String(formData.get("techNotes") ?? "")`), so the offline queue record
//   never actually has an absent techNotes — this override documents that
//   instead of silently drifting from the canonical schema.
// - `addressLine2`/`addressZip` are required strings (possibly ""), not
//   optional — same reasoning as techNotes: new-job-form.tsx always writes a
//   string for every form field via `String(formData.get(...) ?? "")`, so
//   the offline queue record never actually has these fields absent.
export type QueuedJob = Omit<
  TechnicianWritableJobFields,
  "date" | "techNotes" | "addressLine2" | "addressZip"
> & {
  date: string;
  techNotes: string;
  addressLine2: string;
  addressZip: string;
  status: "queued" | "synced";
  queuedAt: string;
};

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
