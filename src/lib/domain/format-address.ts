// Composes a Job's structured address fields (issue #33) back into one
// readable display string — for the dashboard table, CSV export, and
// duplicate-hint matching, none of which need the underlying storage to stop
// being structured. Pure, framework-free, no I/O.
//
// Format: "Street[, Line2], City, State Zip" (Zip omitted with no leading
// space when absent), e.g. "123 Main St, Apt 4, Savannah, GA 31401".
export interface AddressParts {
  addressStreet: string;
  addressLine2: string | null;
  addressCity: string;
  addressState: string;
  addressZip: string | null;
}

export function formatAddress(parts: AddressParts): string {
  const line1Parts = [parts.addressStreet, parts.addressLine2].filter(
    (part): part is string => Boolean(part && part.trim().length > 0),
  );
  const cityStateZip = [parts.addressCity, [parts.addressState, parts.addressZip].filter(Boolean).join(" ")]
    .filter((part) => part && part.trim().length > 0)
    .join(", ");

  return [line1Parts.join(", "), cityStateZip].filter((part) => part.length > 0).join(", ");
}
