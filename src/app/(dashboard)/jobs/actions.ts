"use server";

import { revalidatePath } from "next/cache";
import { auth } from "../../../../auth";
import {
  FieldConflictError,
  JobNotFoundError,
  updateJobAddressCity,
  updateJobAddressLine2,
  updateJobAddressState,
  updateJobAddressStreet,
  updateJobAddressZip,
  updateJobBoreFootage,
  updateJobClosedOut,
  updateJobDirectionalBore,
  updateJobDiscrepancyFlag,
  updateJobFiberCode,
  updateJobFiberFootage,
  updateJobLocate,
  updateJobPrebury,
  updateJobTechNotes,
  type Job,
} from "@/db/queries/jobs";
import type { DashboardEditableJobFields } from "@/lib/domain/job-fields";

// Only Office Staff may edit Jobs — mirrors src/app/(dashboard)/markets/actions.ts's
// role gate. Real credential verification lands in ticket #4; the Server
// Action tests exercise this by mocking `auth()`'s return value.
async function requireOfficeStaff() {
  const session = await auth();
  if (session?.user?.role !== "office_staff") {
    throw new Error("Forbidden: office staff only");
  }
}

// Fields Office Staff may correct after the fact — deliberately excludes Job
// Number, Market, and Technician (not correctable per the domain model).
// Close-Out and Discrepancy Flag (ticket #8) are included: both are toggled
// exclusively by Office Staff, never by Technicians. Kept as a literal union
// rather than an arbitrary client-sent string, so the field name itself is
// checked at compile time everywhere this type is used.
export type EditableJobField =
  | "addressStreet"
  | "addressLine2"
  | "addressCity"
  | "addressState"
  | "addressZip"
  | "fiberCode"
  | "fiberFootage"
  | "boreFootage"
  | "locate"
  | "directionalBore"
  | "prebury"
  | "techNotes"
  | "discrepancyFlag"
  | "closedOut";

// Ties each EditableJobField to its value type by picking from the
// dashboard-editable subset of the canonical Job schema (see
// src/lib/domain/job-fields.ts) rather than an independently redeclared
// field list. `Pick<...>` itself fails to compile if EditableJobField ever
// names a field that doesn't exist on DashboardEditableJobFields — the
// type-level constraint issue #22 asks for, without a separate unused
// assertion. `Required<...>` restores the pre-refactor behavior that every
// field here has a concrete value (never `undefined`) — this map describes
// an already-persisted Job's current field value, not a fresh submission
// where e.g. techNotes may be genuinely absent.
export type FieldValueMap = Required<Pick<DashboardEditableJobFields, EditableJobField>>;

export type UpdateJobFieldResult =
  | { status: "success"; job: Job }
  | { status: "conflict"; message: string }
  | { status: "not_found"; message: string };

// Per-field update function shape, correlated to a single EditableJobField
// `F` via FieldValueMap so `expectedOldValue`/`newValue` keep the field's own
// value type (string, FiberCode, number, or boolean) rather than a widened
// union or `any`.
type UpdateJobFieldFn<F extends EditableJobField> = (
  id: string,
  expectedOldValue: FieldValueMap[F],
  newValue: FieldValueMap[F],
) => Promise<Job>;

// Table-driven replacement for the old eleven-arm `switch` (issue #25,
// Candidate C of the architecture review). This is a mapped type indexed by
// EditableJobField — not a `Record<EditableJobField, V>` — because a Record
// forces every entry to share one value type V, which is exactly what
// doesn't hold here (updateJobFiberCode wants a FiberCode, updateJobLocate
// wants a boolean, etc.). The mapped type keeps each entry's function
// correlated to its own field via FieldValueMap[F], so every function below
// is assigned here with its real, already-declared signature — no casts, no
// `any`. TypeScript still requires every EditableJobField to be present (a
// missing key is a compile error), preserving the switch's exhaustiveness
// guarantee.
const updateJobFieldDispatch: { [F in EditableJobField]: UpdateJobFieldFn<F> } = {
  addressStreet: updateJobAddressStreet,
  addressLine2: updateJobAddressLine2,
  addressCity: updateJobAddressCity,
  addressState: updateJobAddressState,
  addressZip: updateJobAddressZip,
  fiberCode: updateJobFiberCode,
  fiberFootage: updateJobFiberFootage,
  boreFootage: updateJobBoreFootage,
  locate: updateJobLocate,
  directionalBore: updateJobDirectionalBore,
  prebury: updateJobPrebury,
  techNotes: updateJobTechNotes,
  discrepancyFlag: updateJobDiscrepancyFlag,
  closedOut: updateJobClosedOut,
};

/**
 * The single Office Staff entry point for correcting a Job field. Dispatches
 * to the matching per-field compare-and-swap query in src/db/queries/jobs.ts
 * — the `field` argument is constrained to EditableJobField at compile time
 * (not validated against an arbitrary client string at runtime), and
 * `expectedOldValue`/`newValue` are typed to match that field via
 * FieldValueMap, so a caller can't mismatch e.g. a boolean value against
 * `techNotes`.
 *
 * A stale `expectedOldValue` (someone else already changed this exact field)
 * or a since-deleted Job surface as distinct, named result variants rather
 * than a thrown error reaching the UI — the caller decides how to render
 * each ("this changed, reload" vs "this job no longer exists").
 */
export async function updateJobFieldAction<F extends EditableJobField>(
  id: string,
  field: F,
  expectedOldValue: FieldValueMap[F],
  newValue: FieldValueMap[F],
): Promise<UpdateJobFieldResult> {
  await requireOfficeStaff();

  try {
    const updateFn = updateJobFieldDispatch[field];
    const job = await updateFn(id, expectedOldValue, newValue);

    revalidatePath("/jobs");
    return { status: "success", job };
  } catch (error) {
    if (error instanceof FieldConflictError) {
      return { status: "conflict", message: error.message };
    }
    if (error instanceof JobNotFoundError) {
      return { status: "not_found", message: error.message };
    }
    throw error;
  }
}
