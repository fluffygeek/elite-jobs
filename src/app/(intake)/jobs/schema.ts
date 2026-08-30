import type { z } from "zod";
import { technicianWritableJobFieldsSchema } from "@/lib/domain/job-fields";

// Shared validation for a submitted Job, used by both the online path
// (actions.ts's submitJob Server Action) and the offline-sync path
// (api/sync/route.ts). Kept in one place so the two entry points can never
// drift apart on what a valid Job submission looks like — see AGENTS.md's
// ground rule that Zod validation belongs "at every API boundary" and
// applies especially to api/sync.
//
// A thin re-export of the canonical Job schema's technician-writable subset
// (src/lib/domain/job-fields.ts) — a Technician submission never carries
// Discrepancy Flag or Close-Out (those are Office-Staff-only, added later at
// dashboard edit time).
export const submitJobSchema = technicianWritableJobFieldsSchema;

export type SubmitJobInput = z.input<typeof submitJobSchema>;
