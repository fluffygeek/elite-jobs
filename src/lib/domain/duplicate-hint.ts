// Duplicate-hint matching — see CONTEXT.md's "Job" entry and issue #1/#7's
// spec: Jobs sharing the same Address and Date (with different Job Numbers)
// are a *soft* signal Office Staff should look at, not a hard constraint
// (the hard constraint is the existing `(market_id, job_number)` uniqueness,
// enforced at the database level — see src/db/queries/jobs.ts's
// DuplicateJobNumberError). Pure, framework-free, no I/O.
//
// Matching rule: exact Address match (case/whitespace-insensitive) + same
// calendar date, per docs/architecture.md's "Missing pieces" note that an
// exact match is the deliberate MVP starting point, tightened later if it
// proves noisy. "Address" here is the composed structured-fields string (see
// src/lib/domain/format-address.ts) — issue #33 replaced the single
// free-text Address column with structured fields, but this matching rule's
// behavior is unchanged: it still compares the full readable address.

export interface DuplicateHintCandidate {
  id: string;
  address: string;
  date: Date;
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function matchKey(job: DuplicateHintCandidate): string {
  return `${normalizeAddress(job.address)}|${dateKey(job.date)}`;
}

/**
 * Given a list of Jobs, returns the ids of every Job that shares its Address
 * and Date with at least one other Job in the list. A Job that's alone at
 * its Address+Date is never included, even though it triggered the
 * `Map.get` — see the `> 1` check below.
 */
export function findDuplicateHintIds(jobsList: DuplicateHintCandidate[]): Set<string> {
  const counts = new Map<string, number>();
  for (const job of jobsList) {
    const key = matchKey(job);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const flagged = new Set<string>();
  for (const job of jobsList) {
    if ((counts.get(matchKey(job)) ?? 0) > 1) {
      flagged.add(job.id);
    }
  }

  return flagged;
}
