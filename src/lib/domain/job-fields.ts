import { z } from "zod";
import { fiberCodeEnum } from "@/db/schema";

// Canonical shape + validation for a Job's submittable/editable fields —
// issue #22's fix for six independent declarations of "what fields does a
// Job have" drifting apart over time. Every consumer below derives from this
// schema via `.omit()` rather than redeclaring the field list.
//
// Deliberately excluded (see the design section of issue #22):
// - `technicianId`: server-injected from the authenticated session *after*
//   validation, in both the online (submitJob) and offline (api/sync) paths.
//   Never part of what a client submits.
// - Job Site and Bore Code: server-computed, never client-input — see
//   ComputedJobFields below, a structurally separate type that isn't
//   reachable via any `.omit()` on this schema.
export const jobFieldsSchema = z.object({
  // Client-generated UUID (crypto.randomUUID() in the browser) that is the
  // Job's identity end-to-end — see ADR 0001 and src/db/schema.ts's comment
  // on jobs.id. Genuinely client-submitted data, unlike technicianId.
  id: z.string().uuid(),
  marketId: z.string().uuid(),
  jobNumber: z.string().trim().min(1, "Job Number is required"),
  date: z.coerce.date(),
  address: z.string().trim().min(1, "Address is required"),
  fiberCode: z.enum(fiberCodeEnum),
  fiberFootage: z.coerce.number().int().min(0),
  boreFootage: z.coerce.number().int().min(0),
  locate: z.coerce.boolean(),
  directionalBore: z.coerce.boolean(),
  prebury: z.coerce.boolean(),
  // Optional at the schema layer — see src/db/queries/jobs.ts's createJob,
  // which is the actual place an absent value gets defaulted to "" (both at
  // the online-submission validation boundary and when called directly, as
  // some tests do, bypassing this schema entirely). Kept optional here to
  // match that existing behavior rather than defaulting in two places.
  techNotes: z.string().trim().optional(),
  // Office-Staff-only fields (issue #8) — don't exist at Job creation, only
  // at dashboard edit time. See technicianWritableJobFieldsSchema below for
  // the subset that omits these.
  discrepancyFlag: z.coerce.boolean(),
  closedOut: z.coerce.boolean(),
});

export type JobFields = z.infer<typeof jobFieldsSchema>;
export type JobFieldsInput = z.input<typeof jobFieldsSchema>;

// Job Site (state + zip, derived from Address) and Bore Code (derived from
// Bore Footage) are computed server-side on every write — see
// src/lib/domain/job-site.ts and src/lib/domain/bore-payment-tier.ts, and
// AGENTS.md's "Bore Code is computed, never client-trusted" ground rule.
// This is a genuinely different type, not a `.omit()`/`.pick()` of
// jobFieldsSchema, so there's no way to accidentally widen the input schema
// to accept these from a client.
export interface ComputedJobFields {
  jobSiteState: string;
  jobSiteZip: string;
  boreCode: string;
}

// The subset a Technician actually submits/writes: everything except the
// Office-Staff-only fields Discrepancy Flag and Close-Out, which don't exist
// yet at Job creation. Used both as the online/offline submission schema
// (src/app/(intake)/jobs/schema.ts's submitJobSchema) and as the base shape
// for src/db/queries/jobs.ts's CreateJobInput and src/lib/offline/db.ts's
// QueuedJob.
export const technicianWritableJobFieldsSchema = jobFieldsSchema.omit({
  discrepancyFlag: true,
  closedOut: true,
});

export type TechnicianWritableJobFields = z.infer<typeof technicianWritableJobFieldsSchema>;

// The subset Office Staff may correct after the fact (src/app/(dashboard)/jobs/actions.ts) —
// everything except Job Number, Market, and Date, which aren't correctable
// per CONTEXT.md's immutability of those fields once submitted.
export const dashboardEditableJobFieldsSchema = jobFieldsSchema.omit({
  jobNumber: true,
  marketId: true,
  date: true,
});

export type DashboardEditableJobFields = z.infer<typeof dashboardEditableJobFieldsSchema>;
