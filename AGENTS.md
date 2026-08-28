# Elite Jobs

A job-tracking app replacing a Google Sheets workflow for a fiber/bore installation business: field Technicians submit Jobs offline-first from mobile devices, Office Staff review and close them out across multiple geographic Markets without overwriting each other's edits. See [CONTEXT.md](./CONTEXT.md) for domain vocabulary, [docs/architecture.md](./docs/architecture.md) for the full technical decision record, and [docs/elite-jobs-mvp.prd.md](./docs/elite-jobs-mvp.prd.md) for product intent.

**Stack**: Next.js (App Router) + TypeScript, Postgres via Drizzle, Auth.js, Dexie.js (client IndexedDB), Serwist (PWA/service worker), deployed on Vercel.

## Architecture map

```
src/
  app/
    (dashboard)/          Office Staff surface — Server Actions for interactive mutations
    (intake)/              Technician PWA surface — offline-first job intake form
    api/sync/               Route Handler(s) for offline job sync — plain JSON, not Server Actions
                            (service workers can't invoke Server Actions)
    api/export/             Route Handler(s) streaming CSV on demand (general + Discrepancy-flagged)
  db/
    schema.ts              Drizzle schema: Market, User, Job, Invitation
    queries/                Targeted, field-level update queries (see Ground rules)
  lib/
    domain/                 Pure domain logic: Bore Payment Tier computation, duplicate-hint matching
                            — framework-free, unit-testable in isolation
    offline/                Dexie.js local schema + sync queue logic (shared by the PWA shell)
  auth/                     Auth.js config, role/permission checks
```

## Ground rules

- **Never write a full-record "save the whole Job" mutation.** Every write is a targeted update to a specific field or field-group (e.g. "set discrepancy flag", "update tech notes"). This is the mechanism the entire concurrency-safety design depends on — see docs/architecture.md's "Key decisions" section before touching Job mutations.
- **Same-field concurrent edits** use a per-field compare-and-swap update (`WHERE id = ? AND field = expectedOldValue`), rejected with a "this changed, reload" error when the old value doesn't match — never silently overwritten and never resolved by locking the whole row. See issue #1's spec for the full rationale.
- **Bore Code is computed, never client-trusted.** It's recomputed server-side from `bore_footage` on every save via the tier rule in CONTEXT.md, and persisted (not read-time-only) so historical Jobs retain the code that applied when they were billed.
- **Route Handlers vs Server Actions**: the offline-sync path (`api/sync`) is a plain JSON Route Handler because service workers need real HTTP endpoints. The Office Staff dashboard's interactive mutations use Server Actions. Don't mix these — a dashboard mutation doesn't need offline queuing, and the sync path can't use Server Actions.
- **`(market_id, job_number)` is a hard uniqueness constraint** at the database level — not just app-level validation.
- **Drizzle, not Prisma or raw SQL strings** — chosen for serverless cold-start cost and precise control over targeted-field queries.
- **Auth.js, not Clerk or custom auth** — no per-user billing, fits the project's budget constraint.

## Working principles (agent steering)

- **Plan before non-trivial work.** For anything beyond a small fix — a new endpoint, a schema change, touching the concurrency/sync logic — sketch the approach and check in before writing code.
- **Ask when genuinely ambiguous; don't guess silently.** Several domain/architecture decisions were deliberately left open (see "Open questions" in docs/architecture.md and the PRD) — when work touches one of those, ask rather than picking an interpretation and moving on.
- **Engineering primitives**: strict TypeScript (no `any`), explicit errors — no silent `catch` blocks, Zod (or equivalent) validation at every API boundary (this matters especially at `api/sync` and `api/export`, which cross the offline/role-permission boundary), no premature abstraction — three similar lines beat a speculative shared helper.

## Commands

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest
- `npm run db:generate` — generate a Drizzle migration from `src/db/schema.ts`
- `npm run db:migrate` — apply pending migrations to `DATABASE_URL`

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `fluffygeek/elite-jobs` (uses the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

## On-demand context

- [CONTEXT.md](./CONTEXT.md) — domain glossary (Job, Market, Bore Payment Tier, Discrepancy Flag, etc.)
- [docs/architecture.md](./docs/architecture.md) — full technical decision record, open questions, the iOS offline-retention spike
- [docs/elite-jobs-mvp.prd.md](./docs/elite-jobs-mvp.prd.md) — product intent, hypothesis, success metrics
- [docs/adr/](./docs/adr/) — architecture decision records (currently: 0001, offline-first Job submission)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
