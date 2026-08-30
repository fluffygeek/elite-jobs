import { redirect } from "next/navigation";
import { updateJobFieldAction, type EditableJobField, type FieldValueMap } from "./actions";

// Value-parsing and dispatch glue for the dashboard's per-field edit forms in
// page.tsx (issue #24) — split out so it's unit-testable without rendering
// the page, and so page.tsx goes back to being pure rendering.

// Fields that are numbers/booleans need their raw FormData string (and the
// hidden "old value" string carried in each field's form) parsed into the
// right type before reaching the strongly-typed updateJobFieldAction. This
// glue lives here, at the UI edge, rather than loosening the action's types.
//
// Generic over F (rather than the wide EditableJobField union) so that a
// caller who *does* have a literal field (e.g. FiberCodeFieldForm's
// "fiberCode") gets a precisely-typed result, and so submitFieldEdit below
// can thread a single F through to updateJobFieldAction with no cast at that
// call site.
export function parseFieldValue<F extends EditableJobField>(field: F, raw: string): FieldValueMap[F] {
  let value: FieldValueMap[EditableJobField];
  switch (field) {
    case "fiberFootage":
    case "boreFootage":
      value = Number(raw);
      break;
    case "locate":
    case "directionalBore":
    case "prebury":
    case "discrepancyFlag":
    case "closedOut":
      value = raw === "true";
      break;
    default:
      value = raw;
  }

  // Inside a generic function body, `field`'s narrowing in the switch above
  // narrows the *runtime* value but not the type parameter F itself — F stays
  // abstract, so TypeScript can't verify that `value` (typed as the union of
  // every field's value type) is specifically FieldValueMap[F] rather than
  // some other member of that union. Callers always pass a matching
  // field/raw pair (the switch above guarantees the runtime type lines up
  // with whichever field F actually is), so the narrowing is sound — just
  // not something the type checker can confirm from inside a generic
  // function. This is the module's one remaining cast.
  return value as FieldValueMap[F];
}

export async function submitFieldEdit<F extends EditableJobField>(
  jobId: string,
  field: F,
  expectedOldValueRaw: string,
  formData: FormData,
) {
  "use server";

  const newValueRaw = String(formData.get("newValue") ?? "");
  const expectedOldValue = parseFieldValue(field, expectedOldValueRaw);
  const newValue = parseFieldValue(field, newValueRaw);

  const result = await updateJobFieldAction(jobId, field, expectedOldValue, newValue);

  if (result.status === "success") {
    redirect(`/jobs?notice=${encodeURIComponent(`${field} updated`)}`);
  }
  redirect(`/jobs?notice=${encodeURIComponent(result.message)}&error=1`);
}
