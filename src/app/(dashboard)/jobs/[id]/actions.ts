"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "../../../../../auth";
import {
  JobNotFoundError,
  LockNotHeldError,
  releaseJobLock,
  updateJob,
  type JobUpdatePatch,
} from "@/db/queries/jobs";
import { dashboardEditableJobFieldsSchema } from "@/lib/domain/job-fields";
import type { Session } from "next-auth";

// Mirrors src/app/(dashboard)/jobs/actions.ts's role gate.
async function requireOfficeStaffSession(): Promise<Session> {
  const session = await auth();
  if (session?.user?.role !== "office_staff") {
    throw new Error("Forbidden: office staff only");
  }
  return session;
}

// FormData carries every boolean field as the literal string "true"/"false"
// (see the <select> elements in page.tsx) — read it as a real boolean before
// validation, rather than relying on z.coerce.boolean(), which treats any
// non-empty string (including the literal string "false") as true.
function readBoolean(formData: FormData, name: string): boolean {
  return formData.get(name) === "true";
}

// Empty string from a plain-text form field means "no value" for the
// nullable address parts — same normalization the old per-field CAS
// updateJobAddressLine2/updateJobAddressZip performed.
function normalizeNullableAddressPart(value: string): string | null {
  return value.length > 0 ? value : null;
}

// dashboardEditableJobFieldsSchema still requires `id` (jobFieldsSchema's
// client-generated-UUID field, omitted only for jobNumber/date) — irrelevant
// here since the Job's id comes from the route param, not the edit form, so
// it's omitted again locally rather than threading a redundant hidden field
// through every form submission.
const jobUpdateFormSchema = dashboardEditableJobFieldsSchema.omit({ id: true });

function parsePatch(formData: FormData): JobUpdatePatch {
  const parsed = jobUpdateFormSchema.parse({
    addressStreet: formData.get("addressStreet"),
    addressLine2: formData.get("addressLine2"),
    addressCity: formData.get("addressCity"),
    addressState: formData.get("addressState"),
    addressZip: formData.get("addressZip"),
    fiberCode: formData.get("fiberCode"),
    fiberFootage: formData.get("fiberFootage"),
    boreFootage: formData.get("boreFootage"),
    locate: readBoolean(formData, "locate"),
    directionalBore: readBoolean(formData, "directionalBore"),
    prebury: readBoolean(formData, "prebury"),
    techNotes: formData.get("techNotes"),
    discrepancyFlag: readBoolean(formData, "discrepancyFlag"),
    closedOut: readBoolean(formData, "closedOut"),
  });

  return {
    addressStreet: parsed.addressStreet,
    addressLine2: normalizeNullableAddressPart(parsed.addressLine2 ?? ""),
    addressCity: parsed.addressCity,
    addressState: parsed.addressState,
    addressZip: normalizeNullableAddressPart(parsed.addressZip ?? ""),
    fiberCode: parsed.fiberCode,
    fiberFootage: parsed.fiberFootage,
    boreFootage: parsed.boreFootage,
    locate: parsed.locate,
    directionalBore: parsed.directionalBore,
    prebury: parsed.prebury,
    techNotes: parsed.techNotes ?? "",
    discrepancyFlag: parsed.discrepancyFlag,
    closedOut: parsed.closedOut,
  };
}

/**
 * Saves every field on a Job in one combined update (issue #34's whole-Job
 * save, replacing the old per-field updateJobFieldAction). Requires the
 * caller to currently hold the pessimistic lock — updateJob itself enforces
 * that and releases the lock as part of the same call, so a successful save
 * always leaves the Job unlocked. A stale/stolen lock or a deleted Job
 * surfaces as a clear notice on the list page rather than a thrown error
 * reaching the UI.
 */
export async function saveJob(jobId: string, formData: FormData): Promise<void> {
  const session = await requireOfficeStaffSession();
  const patch = parsePatch(formData);

  try {
    await updateJob(jobId, patch, session.user.id);
  } catch (error) {
    if (error instanceof LockNotHeldError || error instanceof JobNotFoundError) {
      redirect(`/jobs?notice=${encodeURIComponent(error.message)}&error=1`);
    }
    throw error;
  }

  revalidatePath("/jobs");
  redirect(`/jobs?notice=${encodeURIComponent("Job updated")}`);
}

/**
 * Releases the lock without saving (issue #34's "Release flow" — Cancel).
 * releaseJobLock no-ops if the caller doesn't actually hold the lock (it may
 * have already expired), which is fine here: either way the caller's intent
 * — "I'm done editing" — is satisfied by landing back on the list.
 */
export async function cancelEdit(jobId: string): Promise<void> {
  const session = await requireOfficeStaffSession();
  await releaseJobLock(jobId, session.user.id);
  revalidatePath("/jobs");
  redirect("/jobs");
}
