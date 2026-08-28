# Elite Jobs MVP

## Problem Statement

Office Staff at Elite TMG track fiber/bore installation jobs across multiple geographic markets in a shared Google Sheet fed by a separate Google Form. When multiple staff update the same job row at the same time, edits get silently overwritten. On top of that, duplicate job entries, wrong addresses, and jobs that quietly go "outstanding" (submitted but never reviewed or closed out) mean staff can't trust the sheet as a single source of truth — they fall back to manually rechecking records, including manually re-verifying bore-footage payment math. The team has floated switching to Excel as a stopgap, which would not fix any of this. This is a slow-burn problem, not the result of one incident, but it costs Office Staff real time every day and puts job data at risk.

## Evidence

- Office Staff report edits being overwritten when two staff members update the same job row concurrently — direct, first-hand report, not inferred.
- Duplicate job records, incorrect addresses, and jobs left in an "outstanding" (never reviewed/closed-out) state — reported by Office Staff as recurring issues.
- Office Staff currently manually recheck bore-footage payment calculations rather than trusting the sheet — reported directly.
- The business has considered moving to Excel as a fallback, indicating the current tool is seen as actively failing, not just imperfect. — reported directly.
- *Assumption — needs validation*: the root cause of "wrong addresses" (technician typo vs. no field validation vs. something else) has not been confirmed.
- *Assumption — needs validation*: the dollar/time cost of outstanding, un-closed-out jobs has not been quantified.

## Thesis (why build it)

Office Staff are the primary sufferers here: they're the ones reconciling bad data, resolving overwritten edits, and rechecking math the system should just get right. The Google Sheet + Form combo was never designed for multiple people editing concurrently or for computing payment tiers — it's a shared document being used as an application. Now that the business operates across multiple markets, the sheet's failure modes (row collisions, duplicates, drift) compound. This isn't a new problem, but it's reached the point where it's worth fixing properly rather than working around again (e.g. via Excel), because a spreadsheet-shaped tool cannot solve a concurrent-multi-user, multi-market, computed-data problem — only a proper application with per-record integrity can.

## Hypothesis

> **We believe** giving Office Staff a single-source-of-truth job system — with per-record editing instead of shared-row spreadsheet edits, automatic duplicate detection, and automatic bore-payment-tier computation — **will cause** Office Staff to stop losing/overwriting each other's edits and stop chasing down duplicate or outstanding job records, **resulting in** office staff spending less time reconciling data and closing jobs out faster and more accurately.
>
> **We'll know we're RIGHT if**, within one month of real use, reported edit-collision incidents drop to ~zero and office staff can find any given job's true current status without cross-checking or asking a coworker.
>
> **We'll know we're WRONG if** office staff keep a shadow spreadsheet running in parallel "just in case," duplicate job entries still show up regularly, or staff report it's *slower* to review/close jobs than the old sheet was.

## Target User & JTBD

**Primary user**: Office Staff, reviewing submitted jobs at the start of each day.

**Job-to-be-done**: When a technician submits a job from the field, Office Staff want to trust it's accurate and uniquely recorded, so they can close it out without re-verifying it or colliding with a coworker's edits.

**Secondary user**: Field Technicians, who submit job data from the field (often with poor/no connectivity) via Android or Apple mobile devices — their job is to get a job recorded reliably in one submission, not to review or manage data afterward.

**Non-users** (explicitly out of scope for this product):
- End customers/clients — they never interact with this system.
- Accounting/billing systems — they remain separate and consume the CSV export; this product does not become the billing system of record.
- Technicians do not get a review dashboard or historical view of past jobs in the MVP — their surface is submission only.

## MVP

The thinnest slice that proves the hypothesis end to end:

- An offline-capable job intake form for Field Technicians (works on Android and Apple mobile devices, requires no IT installation/intervention) that reliably records a submission even with poor/no connectivity and prevents duplicate submissions.
- An Office Staff dashboard listing submitted jobs across all markets, where each job can be reviewed and closed out individually without one staff member's edit clobbering another's.
- A **Discrepancy Flag** Office Staff can set on any job that needs attention, plus a dedicated export (single button press) that pulls all currently flagged jobs into their own file, separate from the general export.
- General CSV export of job data for downstream accounting/reporting workflows.
- Automatic computation of the bore-footage payment tier — never entered or trusted from a technician's manual input.

Explicitly NOT in the MVP: photo/file attachments, push/SMS/email notifications, per-market staff scoping (all staff see all markets), a technician-facing history/dashboard.

**Note for the architecture/spec stage**: *how* concurrent edits are prevented from overwriting each other (optimistic locking, field-level saves, last-write-wins with an audit trail, etc.) is the mechanism the entire hypothesis depends on. That decision is deliberately left to `plan-architecture` — but whoever designs the spec should treat it as the highest-stakes decision in this MVP, not a routine implementation detail.

## Success Metrics

| Metric | Target | How measured |
|---|---|---|
| Edit-collision incidents (an edit being silently overwritten by another staff member) | ~0 reported incidents | Office Staff self-report / observed over the 1-month trial window |
| Ability to determine a job's true current status without cross-checking a coworker | Staff report they can do this reliably | Qualitative check-in with Office Staff at end of trial |
| Duplicate job records | Reduced vs. current sheet baseline | *TBD — needs validation: no current baseline duplicate rate has been measured* |
| Time to review and close out a job | Not slower than the current sheet-based process | Qualitative comparison reported by Office Staff |
| Shadow spreadsheet usage | None — Office Staff rely solely on the new system | Observed / self-reported at end of trial |

## Non-goals

- Not building a billing/accounting system — CSV export feeds existing downstream tools instead.
- Not supporting photo/file attachments in this MVP.
- Not sending push, SMS, or email notifications — Office Staff work from the dashboard directly.
- Not scoping Office Staff accounts to specific markets — all staff see all markets in the MVP.
- Not giving Field Technicians a review/history dashboard.
- Not deciding *how* concurrent-edit safety is implemented — that's an engineering decision for the architecture spec.

## Open Questions

- [ ] What actually causes "wrong addresses" today — technician typo, no field validation, or something else? (Affects whether address validation/autocomplete is needed.)
- [ ] What is the real cost of an "outstanding" (un-reviewed/un-closed-out) job today — delayed billing, a job falling through entirely, or mostly an annoyance? (Affects how urgently outstanding-job visibility needs to be surfaced in the dashboard.)
- [ ] What is the current duplicate-job-record rate, to give the "reduced duplicates" success metric a real baseline?
- [ ] What triggers a Discrepancy Flag in practice — is it purely an Office Staff judgment call, or are there specific known discrepancy types worth calling out explicitly (e.g. mismatched address, suspected duplicate, footage that looks wrong)?
- [ ] Budget ceiling — "budget is a consideration" was noted as a constraint, but no concrete number or hosting/tooling budget ceiling has been set.
