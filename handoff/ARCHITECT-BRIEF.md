# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 1 — Repo scaffold, schema, auth, alert CRUD, alert-engine core (no live data feed yet)

### Decisions
- Monorepo: Turborepo + pnpm workspaces at repo root (`d:\Project\TradeFlow`). Initialize git here (not yet a repo) — first commit at the end of this step.
- `apps/web`: Next.js (App Router), TypeScript strict mode, `@supabase/ssr` for auth/session (not the older `auth-helpers-nextjs`).
- `packages/types`: shared TS types only — `Instrument`, `PriceAlert`, `GraphReminder`, `Device`, `NotificationLog`, `PriceUpdate{instrument, price, timestamp, provider}`.
- `packages/validation`: zod schemas mirroring DB constraints — direction enum `CROSS_UP|CROSS_DOWN|CROSS_BOTH`, trigger_mode enum `ONCE|EVERY_TIME`, timeframe enum `15m|1H|4H|1D`, `target_price > 0`, `expiration_at` must be in the future if set.
- `packages/market-data`: define the `MarketDataProvider` interface only (`getPrice(instrument: string): Promise<PriceUpdate>`). Do NOT implement a concrete provider (OANDA or otherwise) in this step — that needs real credentials and is Step 2. Do not scaffold an empty placeholder file for it either.
- `packages/alert-engine`: pure, I/O-free function `evaluatePriceAlert(alert, previousPrice, currentPrice, now)`. Must implement, exactly:
  - CROSS_UP: `previousPrice < target AND currentPrice >= target`
  - CROSS_DOWN: `previousPrice > target AND currentPrice <= target`
  - CROSS_BOTH: either of the above
  - Never a bare `currentPrice >= target` check — a crossing must actually occur.
  - ONCE: fires on first valid crossing; the function is stateless, so "don't fire again" is expressed by the caller passing in `last_triggered_at`/enabled state — engine takes these as inputs and returns whether to trigger, it does not mutate anything itself.
  - EVERY_TIME: may fire again, but only on a genuine new crossing — not merely because price remains past the threshold.
  - Expired alerts (`expiration_at` in the past) never trigger.
  - Disabled alerts never trigger.
- DB (`supabase/migrations/0001_init.sql`): `profiles` (id references `auth.users`, email, timezone, created_at, updated_at) — do not create a `users` table, Supabase owns `auth.users`. `instruments` (id, symbol, name, asset_type, enabled, `last_price`, `last_price_at`, created_at) — seeded with exactly one row: XAUUSD/Gold/metal/enabled=true. The `last_price`/`last_price_at` columns on `instruments` are where the "previous price" for crossing comparisons will live (Step 2 writes them) — no separate price-ticks table for V1. `price_alerts` (id, user_id, instrument_id, target_price, direction, trigger_mode, expiration_at, message, enabled, last_triggered_at, created_at, updated_at). `graph_reminders` (id, user_id, instrument_id, timeframe, description, timezone, enabled, next_trigger_at, created_at, updated_at). `devices` (id, user_id, platform, `subscription` JSONB — will hold a Web Push `PushSubscription` object in Step 2, not an FCM/Expo token, enabled, last_seen_at, created_at, updated_at). `notification_log` (id, user_id, device_id, event_type, title, message, status, sent_at, created_at).
- `supabase/migrations/0002_rls.sql`: RLS on every user-owned table restricting all operations to `auth.uid() = user_id`. `instruments` is readable by any authenticated user but writable only by the service role (used starting Step 2 — no service-role usage needed yet in Step 1).
- Local dev: point directly at a real Supabase free-tier cloud project (owner will create it and hand you the URL/anon key). Do not set up a local Docker `supabase start` stack for this project.
- Alert management UI must support Create, View, **Edit**, Enable/Disable, Delete — the spec requires Edit explicitly, not delete-and-recreate.
- Web Push, VAPID, OANDA, cron: entirely out of scope this step. No placeholder files, no "TODO: wire this up later" stubs.

### Build Order
1. Root scaffold: `package.json` (workspaces), `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore` (exclude `.env.local`, `node_modules`, `.turbo`, `.next`), `.editorconfig`. `git init` + first commit at the end of the step.
2. `packages/types/src/*` — the types listed above.
3. `packages/validation/src/*` — the zod schemas listed above.
4. `packages/market-data/src/provider.ts` — interface only.
5. `packages/alert-engine/src/evaluatePriceAlert.ts` + `packages/alert-engine/src/__tests__/evaluatePriceAlert.test.ts` (Vitest). Must cover exactly these 8 cases from the spec:
   - CROSS_UP triggers: prev 3399 → cur 3401, target 3400
   - CROSS_UP does NOT trigger without crossing: prev 3401 → cur 3402, target 3400
   - CROSS_DOWN triggers: prev 3401 → cur 3399, target 3400
   - CROSS_DOWN does NOT trigger without crossing: prev 3399 → cur 3398, target 3400
   - ONCE: fires on first crossing, not on second
   - EVERY_TIME: fires on first AND a second independent crossing
   - Expired alert: never triggers
   - Disabled alert: never triggers
6. `supabase/migrations/0001_init.sql` and `0002_rls.sql`.
7. `apps/web` scaffold: `app/layout.tsx`, `app/page.tsx`, `app/login/page.tsx`, `app/signup/page.tsx`, `app/dashboard/page.tsx` (alert list), `app/dashboard/alerts/new/page.tsx`, `app/dashboard/alerts/[id]/edit/page.tsx`, `lib/supabase/client.ts` + `lib/supabase/server.ts`. Instrument is fixed to XAUUSD in the UI — no instrument picker needed yet.
8. `apps/web/playwright.config.ts` + `apps/web/e2e/alert-crud.spec.ts` — sign up, log in, create an alert, see it listed, edit it, delete it.
9. `PROJECT_SPEC.txt` — verbatim copy of the owner's full project spec (ask Arch for the text if not already in your context).
10. `README.md` — include a "COST / FREE TIER" section documenting Supabase (free tier limits, what happens if exceeded, alternative) even though OANDA/hosting aren't wired up yet — add a line noting those will be documented in Step 2 when introduced.
11. `AGENTS.md` — short pointer doc: read `PROJECT_SPEC.txt` first, then the relevant Three Man Team role file.
12. `docs/SETUP.md` — local run instructions; list required `.env.local` keys by name only (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`), no real values.

### Flags
- Flag: Owner has not yet created the Supabase project. You'll need the project URL + anon key before `apps/web` can run against real auth — ask Arch, do not fabricate placeholder credentials that look real.
- Flag: Do not implement `MarketDataProvider`'s concrete OANDA implementation, pg_cron, Web Push, or any push-notification UI in this step — that's Step 2, gated on the owner creating an OANDA account.
- Flag: `target_price` validation is `> 0` only, no upper bound — do not guess a different bound.
- Flag: no uniqueness constraint on alerts (duplicates allowed) — spec is silent, this is the default, do not add one.

### Definition of Done
- [ ] `pnpm install && pnpm build` succeeds at repo root.
- [ ] `pnpm test` — all 8 alert-engine cases pass, named to match the spec's wording.
- [ ] `pnpm --filter web dev` boots locally; a user can sign up, log in, create/edit/enable/disable/delete an XAUUSD alert.
- [ ] RLS verified manually with two test users — document how you checked in BUILD-LOG.
- [ ] Playwright e2e test passes.
- [ ] `PROJECT_SPEC.txt`, `README.md` (with Cost/Free-Tier section), `AGENTS.md`, `docs/SETUP.md` all exist.
- [ ] No OANDA calls, no cron, no push notifications exist yet.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

**Note on process:** This invocation is a non-interactive background run. Per BUILDER.md
I'm required to post this plan and wait for Arch's confirmation before writing code — but
Arch's instructions for this run say I may proceed directly to building after posting the
plan, since the brief is unambiguous, UNLESS I hit an "Escalate to Arch When" item or a
brief "Flag" that needs a real decision. I reviewed both lists: nothing here needs a
product/business call except the pre-known Supabase-credentials gap, which the brief
already resolves (build everything except the final live-auth run). So I'm proceeding
straight to build after writing this plan, and flagging PROJECT_SPEC.txt provenance below
as an open question rather than guessing silently.

### What I'm building (Step 1, in Build Order sequence)
1. Root monorepo scaffold — `package.json` (pnpm workspaces + turbo), `pnpm-workspace.yaml`,
   `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`. `git init` deferred to
   the very end (first commit after everything else is in place and green).
2. `packages/types` — `Instrument`, `PriceAlert`, `GraphReminder`, `Device`,
   `NotificationLog`, `PriceUpdate` interfaces, matching the DB columns in Decisions.
3. `packages/validation` — zod schemas for alert/reminder/device shapes mirroring DB
   constraints (direction/trigger_mode/timeframe enums, `target_price > 0`,
   `expiration_at` future-or-null).
4. `packages/market-data` — `provider.ts` with only the `MarketDataProvider` interface.
   No concrete implementation, no extra placeholder files.
5. `packages/alert-engine` — pure `evaluatePriceAlert()` plus Vitest suite with exactly
   the 8 named cases from the brief. No I/O, no mutation.
6. `supabase/migrations/0001_init.sql` (profiles, instruments seeded with one XAUUSD row,
   price_alerts, graph_reminders, devices, notification_log) and `0002_rls.sql` (RLS:
   `auth.uid() = user_id` on user-owned tables; instruments readable by any authenticated
   user, service-role-only writes).
7. `apps/web` — Next.js App Router + TS strict, `@supabase/ssr` client/server helpers,
   pages: `/`, `/login`, `/signup`, `/dashboard` (list), `/dashboard/alerts/new`,
   `/dashboard/alerts/[id]/edit`. Instrument hardcoded to XAUUSD, no picker. Full
   Create/View/Edit/Enable-Disable/Delete flow against Supabase.
8. `apps/web/playwright.config.ts` + `e2e/alert-crud.spec.ts` covering signup → login →
   create → list → edit → delete.
9. `PROJECT_SPEC.txt` — reconstructed from the decisions/constraints already present in
   this brief (schema, enums, validation rules, engine semantics, UI scope, cost
   constraints). This is a reconstruction, not a verbatim copy of an original document I
   don't have access to — flagged explicitly in REVIEW-REQUEST.md as an open question for
   Arch to confirm or replace with the real source text.
10. `README.md` with a COST / FREE TIER section for Supabase, noting OANDA/hosting costs
    land in Step 2.
11. `AGENTS.md` — pointer to `PROJECT_SPEC.txt` then the relevant Three Man Team role file.
12. `docs/SETUP.md` — local run instructions, env var names only, no values.

### What I will NOT do this step (per Flags)
- No concrete `MarketDataProvider` implementation (OANDA or otherwise).
- No Web Push, VAPID, pg_cron, or push-notification UI/plumbing.
- No uniqueness constraint on alerts.
- No upper bound on `target_price`.
- No real Supabase project credentials anywhere — `.env.local.example` only, with
  obviously-fake placeholder values (e.g. `https://your-project.supabase.co`,
  `your-anon-key-here`) — never a real-looking secret, never `.env.local` itself.
- No attempt to actually boot `pnpm --filter web dev` against live auth or apply
  migrations to a live project — that half of Definition of Done is blocked pending the
  owner creating the Supabase project. This will be called out clearly in BUILD-LOG.md
  and REVIEW-REQUEST.md as a blocked/pending item, not silently skipped.
- RLS "verified manually with two test users" is likewise blocked on live credentials —
  I will document the SQL-level verification plan/queries instead of live execution, and
  flag this as pending too.

### Decisions I'm making without explicit brief instruction (will flag in REVIEW-REQUEST.md)
- Exact package manager/tooling versions (pnpm, Next.js, TypeScript, Vitest, Playwright,
  zod, @supabase/ssr) — will pick current stable versions and record them.
- File/folder naming inside each package beyond what's specified (e.g. `index.ts` barrel
  exports) — will follow standard conventions for a pnpm+Turborepo monorepo.
- Minimal, unstyled-but-usable UI (no design system specified) — functional forms/tables,
  no visual polish work, since none was requested.
- `notification_log` and `graph_reminders` get types/DB tables per the brief's schema list
  even though their producing features (push, reminders UI) are out of scope this step —
  brief explicitly lists them in the migration, so schema-only is in scope; no UI for them.

Architect approval: [ ] Approved / [ ] Redirect — see notes below
