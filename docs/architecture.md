# Architecture — Elite Jobs MVP

## Problem & goals

Office Staff need a single source of truth for fiber/bore installation jobs submitted by Field Technicians across multiple markets — one where concurrent edits from different staff never silently overwrite each other, duplicate/outstanding jobs are visible rather than hidden in a shared sheet, and bore-footage payment math is computed automatically instead of manually rechecked. Every decision below is judged against whether it serves that: can two office staff work the same job list at once without stepping on each other, and can a technician reliably get a job recorded from the field with poor or no connectivity.

## Approaches considered

**Concurrency safety** (the crux of the whole PRD hypothesis):
- **Pessimistic whole-Job locking (current — see ADR 0002)** — Office Staff acquire an exclusive lock on the entire Job record by opening it in the detail/edit view, make every change (including Discrepancy Flag and Close-Out) in one combined save, and release the lock on save or cancel; the lock auto-expires after 15 minutes of inactivity, checked lazily at acquire time rather than via a background job. Chosen over the original field-level CAS design below because it matches staff's actual mental model — one person edits a Job at a time — better than "edit whatever you want, find out about conflicts after the fact" does. See docs/adr/0002-pessimistic-locking-for-job-edits.md for the full reversal rationale.
- Field-level targeted updates + narrow optimistic locking (original MVP design, replaced by the above per ADR 0002) — the API only accepted targeted mutations to specific fields/field-groups (e.g. "set discrepancy flag", "update tech notes"), so edits to different fields on the same Job never conflicted at all. A same-field concurrent edit was caught with a per-field-group compare-and-swap check and rejected with "this changed, reload" rather than silently discarded. Worked correctly, but asked staff to reason about a finer-grained conflict model than the workflow actually needed.
- Row-level optimistic locking (single `version` column, any save requires it) — rejected: still produces false-positive conflicts when two staff edit unrelated fields on the same Job simultaneously.
- Real-time collaborative editing (CRDT/OT) — rejected: solves it perfectly but is disproportionate infrastructure for structured form fields edited by a handful of office staff.

**Offline job intake**: already committed via ADR 0001 (offline-first, client-generated Job IDs). This doc decides *how*, not *whether*.

## Recommended approach

A Next.js (App Router) application deployed on Vercel, backed by Postgres, with two distinct surfaces:

1. **Technician intake** — a PWA (installable, no app-store/IT step) that stores Job drafts locally via IndexedDB (Dexie.js) the instant they're created, tagged with a client-generated ID, and syncs them to the server opportunistically whenever the app is online (on load, on reconnect, and periodically while foregrounded) — not relying on the Background Sync API, which iOS Safari doesn't support. The server treats the client-generated ID as the Job's identity, so a retried sync after a dropped connection upserts rather than duplicates.
2. **Office Staff dashboard** — reviews Jobs across all markets, edits a Job (including the Discrepancy Flag and Close-Out) via a pessimistic whole-Job lock (see ADR 0002), and exports CSVs (general and flagged-only) generated on demand.

Both surfaces sit on the same Postgres database and domain logic (bore-payment-tier computation, duplicate detection) so the computation rule and validation live in one place regardless of which surface triggered a write.

## Key decisions

- **Stack & libraries**: Next.js (App Router) + TypeScript, Postgres (Neon or Vercel Postgres), **Drizzle** as the ORM (chosen over Prisma for lighter serverless runtime/cold-start cost and more direct control over the targeted-field-update queries the concurrency model depends on), **Dexie.js** for client-side IndexedDB storage, **Serwist** (maintained service-worker tooling) for the PWA/offline shell, **Auth.js (NextAuth)** for authentication (chosen over Clerk for zero per-user billing, fitting the stated budget constraint), **Resend** (or equivalent) for transactional email (invites, magic links).

- **Data model** (shape, not columns):
  - `Market` — fixed, admin-managed list; `Job` belongs to exactly one.
  - `User` — has a role (`technician` | `office_staff`); a `Job`'s submitter is a `User` with role `technician`.
  - `Job` — belongs to one `Market` and one submitting `Technician`; carries the fields defined in CONTEXT.md (Job Number, Date, Address, derived Job Site, Fiber Code, Fiber Footage, Bore Footage, computed Bore Code, the three Site Attributes, Tech Notes, Close-Out status, Discrepancy Flag). Bore Code is **persisted** (recomputed and overwritten whenever Bore Footage is saved) rather than computed purely at read time, so historical Jobs keep the code that applied under the tier rules at the time they were billed, even if those rules change later.
  - `Job` uniqueness: a constraint on `(market, job_number)` acts as a hard duplicate guard; a same-day-same-address heuristic surfaces a *soft* "possible duplicate" hint to Office Staff rather than blocking, since two genuinely separate jobs can share an address.
  - Invitations: a lightweight `Invitation` (email + role + market visibility, token, expiry) drives the email-invite provisioning flow decided below.

- **Boundaries & contracts**:
  - **Auth/permissions**: enforced server-side on every mutation — Technicians can only create/sync their own Jobs; only Office Staff can set Close-Out or Discrepancy Flag, or edit another user's Job.
  - **API shape**: plain JSON Route Handlers for the offline-sync path (service workers need real HTTP endpoints, not React Server Actions); Server Actions for the Office Staff dashboard's interactive mutations, where offline isn't a concern.
  - **External services**: Postgres (managed), an email provider for invites/magic links. No file/object storage needed — CSV exports (general and Discrepancy-flagged) are generated on demand and streamed, not persisted as files.
  - **Secrets**: DB connection string, Auth.js secret, email provider API key — held as Vercel environment variables, never client-exposed.

- **User provisioning**: real invite flow — an Office Staff admin sends an email invite (role + market visibility), the invitee sets their own credentials via the invite link. Chosen over pre-seeding accounts because a scoped invite flow is barely more work than a seed script and avoids anyone but the invitee ever handling their own credentials.

## Missing pieces

- The `Invitation` flow itself (data model exists above, but the actual send/accept mechanism, token expiry policy, and revocation aren't designed yet — small, but real work).
- Per-field-group boundaries for the targeted-update API aren't enumerated yet (e.g. is "Tech Notes" its own group, or bundled with other tech-entered fields?) — needed before the concurrency model can be implemented, but it's an implementation-level task, not an architectural one.
- The "possible duplicate" heuristic's exact matching rule (same address + same date, fuzzy address matching, etc.) isn't specified — start with an exact match and tighten later if it proves noisy.

## Spikes & experiments

```
Question:      Does an installed elite-jobs PWA reliably retain an offline-queued Job in IndexedDB
                for 7+ days on the iOS versions your technicians actually run? (iOS Safari has
                historically purged site data after ~7 days of inactivity under ITP; installed
                PWAs get some exemption on recent iOS, but this needs verifying on real devices,
                not assumed.)
Spike:         Install the PWA on 1-2 real iPhones, queue a fake offline Job, don't open the app
                for 8-10 days, check whether it survived. ~1 day of calendar time, run in parallel
                with the rest of the build.
Decision rule: Survives → ship offline storage as designed. Doesn't survive → add a lightweight
                local reminder nudging techs to open the app periodically, or shorten the assumed
                "safe to stay offline" window communicated to the team.
```

## Open questions

- [ ] What is the real cost of an "outstanding" job today (from the PRD) — this may later justify surfacing job *age* prominently in the Office Staff dashboard, but isn't decided here.
- [ ] What triggers a Discrepancy Flag in practice (from the PRD) — purely a judgment call, or specific known discrepancy types worth calling out in the UI? Affects dashboard UI, not the data model (a boolean flag suffices either way for MVP).
- [ ] Exact per-field-group boundaries for targeted updates (noted above under Missing pieces) — needed before implementation, deliberately left for the implementation-planning stage.
- [ ] Budget ceiling — "budget is a consideration" was noted in the PRD but no concrete number has been set; affects Postgres tier choice (Neon vs Vercel Postgres) and whether Resend's free tier is sufficient at your invite/notification volume.
