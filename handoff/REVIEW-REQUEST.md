# Review Request — Step 3: Graph/Chart Reminders UI (spec Feature B, Phase 16)
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## Context

Milestone 1 (price alerts + push notifications) is live and proven in production
(see `handoff/BUILD-LOG.md`'s "Milestone 1 Proof"). This step adds the second V1
feature: graph/chart reminders — create/view/edit/enable/disable/delete, reusing
every pattern already established for price alerts. The `graph_reminders` table and
its cron-side evaluation logic already existed and are already running in
production (built during Step 2); this step is UI + one shared-logic extraction,
not new backend architecture. Full detail: `handoff/BUILD-LOG.md`'s new "Step 3"
entry. Builder Plan (written and left in place per BUILDER.md, since this was a
background run): `handoff/ARCHITECT-BRIEF.md`'s Builder Plan section.

This session had full live access to the real Supabase project (unlike Steps
1-2's blocked states) — no blockers, and everything below was verified against
the live project, not only locally.

## What Was Built

### 1. Shared `computeNextTriggerAt` extraction
- **`packages/alert-engine/src/computeNextTriggerAt.ts`** (new, 158 lines) — moved
  verbatim from `supabase/functions/tick/nextTrigger.ts` (deleted). Only change: the
  `ReminderTimeframe` type is now imported from `@tradeflow/types` instead of being
  redefined locally, since `alert-engine` already depends on that package (same as
  `evaluatePriceAlert` importing `PriceAlert` from there).
- **`packages/alert-engine/src/index.ts`** (line 2, new) — re-exports
  `computeNextTriggerAt` alongside the existing `evaluatePriceAlert` export.
- **`packages/alert-engine/src/__tests__/computeNextTriggerAt.test.ts`** (new, 68
  lines) — the same 9 cases from the deleted `nextTrigger.test.ts`, translated from
  bare `Deno.test`/manual-assert to Vitest `describe`/`it`/`expect`.
- **`supabase/functions/tick/nextTrigger.ts`** and **`nextTrigger.test.ts`**
  (deleted) — no duplicate implementation left behind.
- **`supabase/functions/tick/index.ts`** (lines 13-15, 29) — import updated to
  `../../../packages/alert-engine/src/computeNextTriggerAt.ts`, the same relative-
  path pattern already used for `evaluatePriceAlert`. No logic change.

### 2. Validation
- **`packages/validation/src/graphReminder.ts`** (new, 43 lines) —
  `createGraphReminderSchema`/`updateGraphReminderSchema`. Reuses
  `reminderTimeframeSchema` from `./enums.ts`. `timezone` validated against
  `Intl.supportedValuesOf("timeZone")` **plus an explicit `"UTC"` special case** —
  see "Open Question / Flagged Decision" below. `description` optional/nullable,
  capped at 500 chars.
- **`packages/validation/src/index.ts`** (line 3, new) — re-exports the above.
- **`packages/validation/src/__tests__/graphReminder.test.ts`** (new, 82 lines) —
  18 cases: valid/invalid timeframe, valid/invalid IANA timezone (including UTC and
  a fake `GMT+8`-style string), optional/null/empty/over-length description,
  create's `enabled` default vs. update's required `enabled`.

### 3. Server actions
- **`apps/web/app/dashboard/reminder-actions.ts`** (new, 175 lines) —
  `createReminderAction`, `updateReminderAction`, `setReminderEnabledAction`,
  `deleteReminderAction`. Structurally mirrors `dashboard/actions.ts` (own local
  `getXauUsdInstrumentId` copy, not a shared util — the two action files are
  already independent files today, same as `actions.ts`/`device-actions.ts`).
  Every query derives `user.id` from the session and adds an explicit
  `.eq("user_id", user.id)` on top of RLS. `createReminderAction` computes
  `next_trigger_at` via the shared `computeNextTriggerAt` before insert.
  `updateReminderAction` fetches the existing row's `timeframe`/`timezone` first
  and only recomputes `next_trigger_at` when either submitted value actually
  differs from what's stored.

### 4. UI pages
- **`apps/web/app/dashboard/reminders/page.tsx`** (new, 122 lines) — list page:
  Instrument/Timeframe/Description/Next occurrence/Status/Actions columns, same
  table/badge/actions CSS classes already in `globals.css`.
- **`apps/web/app/dashboard/reminders/new/page.tsx`** (new, 78 lines) — create
  form: timeframe dropdown, description textarea, timezone text input defaulting
  to `Intl.DateTimeFormat().resolvedOptions().timeZone` via a post-mount
  `useEffect` (avoids an SSR/client hydration mismatch — starts as an empty
  controlled value on both server and client render).
- **`apps/web/app/dashboard/reminders/[id]/edit/page.tsx`** (new, 29 lines) +
  **`edit-form.tsx`** (new, 76 lines) — edit form, pre-filled from the fetched row.
- No instrument picker anywhere — fixed to XAUUSD, same as price alerts.

### 5. Dashboard nav
- **`apps/web/app/dashboard/page.tsx`** (lines 40-43, +3) — added a "Reminders"
  link in the top-bar actions row.
- The new `reminders/page.tsx`'s equivalent row links back to "Alerts". No new
  CSS, no shared nav component.

### 6. E2E test
- **`apps/web/e2e/reminder-crud.spec.ts`** (new, 46 lines) — sign up, create a
  reminder (timeframe + description), see it listed, edit the description, delete
  it. Mirrors `alert-crud.spec.ts`'s structure and live-Supabase requirements.

### 7. Dependency wiring
- **`apps/web/package.json`** (line 18, +1) — added `@tradeflow/alert-engine:
  workspace:*` (needed for `reminder-actions.ts`'s `computeNextTriggerAt` import;
  the web app previously only depended on `@tradeflow/types`/`@tradeflow/validation`).
- **`pnpm-lock.yaml`** — regenerated via `pnpm install`; diff is 3 lines.

## Open Question / Flagged Decision

**Timezone validator special-cases `"UTC"`.** The brief specified validating
`timezone` with `Intl.supportedValuesOf("timeZone").includes(value)`. Confirmed via
a direct Node check that this returns `false` for `"UTC"` specifically (Node/ECMA-402
doesn't enumerate the bare `"UTC"` alias in that list — only canonical zones like
`Etc/UTC` — even though `Intl.DateTimeFormat` itself accepts `"UTC"` as a `timeZone`
value without issue). This mattered because `"UTC"` is `graph_reminders.timezone`'s
own DB default (`supabase/migrations/0001_init.sql`). Resolved by allowing
`value === "UTC"` in addition to the `supportedValuesOf` check
(`packages/validation/src/graphReminder.ts`), rather than escalating — flagging
because it's a deviation from the brief's literal wording, but the correct behavior
here isn't a judgment call (UTC is unambiguously a valid timezone), just a gap in
what that one API enumerates. Full reasoning also recorded in
`handoff/ARCHITECT-BRIEF.md`'s Builder Plan.

**`description` capped at 500 chars** — not specified in the brief; matched price
alert's `message` field cap for consistency. Easy to change if a different cap (or
no cap) is wanted.

## Verified

- `pnpm build`, `pnpm test`, `pnpm typecheck` at repo root — all green. 63 tests
  total (up from 29): 17 alert-engine (8 `evaluatePriceAlert` + 9
  `computeNextTriggerAt`, moved), 27 validation (9 `device` + 18 `graphReminder`,
  new), 12 market-data, plus `web`'s own build/typecheck.
- `npx playwright test` (`alert-crud.spec.ts` + new `reminder-crud.spec.ts`)
  against the **live** Supabase project — both pass. Exercises the real server
  actions end-to-end through a real browser session, not a mock.
- **Direct live verification of `next_trigger_at` correctness** (one-off script
  via `npx tsx`, not part of the repo, using the anon key with its own throwaway
  test user): confirmed a freshly-created `1H`/`Asia/Kuala_Lumpur` reminder's
  `next_trigger_at` matches `computeNextTriggerAt`'s output to the millisecond,
  confirmed it's correctly recomputed after changing both `timeframe` (→ `1D`) and
  `timezone` (→ `America/New_York`) on update, confirmed RLS blocks a second
  user from seeing the first user's reminder, confirmed delete removes it. This is
  the Definition of Done's "confirm next_trigger_at is set correctly on create and
  recomputed correctly when timeframe/timezone changes" item, checked directly
  against stored DB values.
- `supabase/functions/tick/index.ts`'s import swap was **not** re-verified via
  `deno check` this session (pure relative-path change, identical in shape to the
  already-verified `evaluatePriceAlert` import; this machine's network also blocks
  Postgres ports so a full local Deno function run wasn't repeated). Flagging for
  Richard to spot-check if desired — low risk given the copy-exact pattern.
- RLS/defense-in-depth: every new query in `reminder-actions.ts` and the two
  server-component pages adds `.eq("user_id", user.id)` on top of the existing
  `graph_reminders_*_own` RLS policies (`supabase/migrations/0002_rls.sql`,
  unchanged this step — already covers select/insert/update/delete).

## Known Gaps Logged

- **KG-9** (`handoff/BUILD-LOG.md`) — a handful of `e2e-reminder-*@example.com` /
  `verify-reminder-*@example.com` test users were created in the real Supabase
  project by this session's Playwright runs and verification script. Harmless
  (their `graph_reminders`/`devices` rows were deleted by the tests themselves;
  only the `auth.users` rows remain). Same shape as the pre-existing KG-6.

Ready for Review: YES
