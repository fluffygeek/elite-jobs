// Job Site derivation — see CONTEXT.md's "Job Site" entry: "The state and zip
// code covered by a Job, derived automatically from its Address. Not entered
// independently." Pure, framework-free, no I/O.
//
// Approach: a regex for the "STATE ZIP" pair that appears at the end of a
// standard US address (optionally followed by a country suffix like ", USA"),
// e.g. "104 E Welwood Dr, Savannah, GA 31419, USA" -> { state: "GA", zip:
// "31419" }. This intentionally does not reach for a full address-parsing
// library or a geocoding API — see the ticket brief's guidance that a
// trailing-pattern regex is sufficient for this MVP's US-only address inputs.
//
// A ZIP+4 (e.g. "31419-1234") is accepted but only the 5-digit ZIP is kept,
// matching the Job Site's "zip code" field per CONTEXT.md.
const JOB_SITE_PATTERN =
  /([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?\s*(?:,?\s*(?:USA|U\.S\.A\.|United States(?: of America)?))?\s*$/i;

export interface JobSite {
  state: string;
  zip: string;
}

export class UnparsableAddressError extends Error {
  constructor(address: string) {
    super(
      `Could not derive a Job Site (state + zip) from address: "${address}". ` +
        'Expected a US address ending in "STATE ZIP", e.g. "..., Savannah, GA 31419".',
    );
    this.name = "UnparsableAddressError";
  }
}

export function deriveJobSite(address: string): JobSite {
  const trimmed = address.trim();
  const match = JOB_SITE_PATTERN.exec(trimmed);

  if (!match) {
    throw new UnparsableAddressError(address);
  }

  const [, state, zip] = match;

  return { state: state.toUpperCase(), zip };
}
