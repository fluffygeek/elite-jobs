"use server";

import { revalidatePath } from "next/cache";
import { auth } from "../../../../auth";
import {
  FieldConflictError,
  JobNotFoundError,
  updateJobAddress,
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
import type { FiberCode } from "@/db/schema";
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
  | "address"
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
    let job: Job;

    switch (field) {
      case "address":
        job = await updateJobAddress(id, expectedOldValue as string, newValue as string);
        break;
      case "fiberCode":
        job = await updateJobFiberCode(
          id,
          expectedOldValue as FiberCode,
          newValue as FiberCode,
        );
        break;
      case "fiberFootage":
        job = await updateJobFiberFootage(id, expectedOldValue as number, newValue as number);
        break;
      case "boreFootage":
        job = await updateJobBoreFootage(id, expectedOldValue as number, newValue as number);
        break;
      case "locate":
        job = await updateJobLocate(id, expectedOldValue as boolean, newValue as boolean);
        break;
      case "directionalBore":
        job = await updateJobDirectionalBore(
          id,
          expectedOldValue as boolean,
          newValue as boolean,
        );
        break;
      case "prebury":
        job = await updateJobPrebury(id, expectedOldValue as boolean, newValue as boolean);
        break;
      case "techNotes":
        job = await updateJobTechNotes(id, expectedOldValue as string, newValue as string);
        break;
      case "discrepancyFlag":
        job = await updateJobDiscrepancyFlag(id, expectedOldValue as boolean, newValue as boolean);
        break;
      case "closedOut":
        job = await updateJobClosedOut(id, expectedOldValue as boolean, newValue as boolean);
        break;
      default: {
        // Exhaustiveness check: TypeScript errors here if EditableJobField
        // gains a member without a matching case above.
        const exhaustive: never = field;
        throw new Error(`Unhandled editable Job field: ${exhaustive}`);
      }
    }

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
