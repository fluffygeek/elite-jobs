import { z } from "zod";
import { fiberCodeEnum } from "@/db/schema";

// Shared validation for a submitted Job, used by both the online path
// (actions.ts's submitJob Server Action) and the offline-sync path
// (api/sync/route.ts). Kept in one place so the two entry points can never
// drift apart on what a valid Job submission looks like — see AGENTS.md's
// ground rule that Zod validation belongs "at every API boundary" and
// applies especially to api/sync.
//
// The Job's UUID is client-generated (crypto.randomUUID() in the browser)
// rather than server-assigned — see ADR 0001 and src/db/schema.ts's comment
// on jobs.id. Both submitJob and the sync route treat it as the Job's
// identity.
export const submitJobSchema = z.object({
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
  techNotes: z.string().trim().optional(),
});

export type SubmitJobInput = z.input<typeof submitJobSchema>;
