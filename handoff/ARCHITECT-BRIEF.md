# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 3 — Graph/Chart Reminders UI (spec Feature B, Phase 16)

Milestone 1 is proven (see handoff/BUILD-LOG.md "Milestone 1 Proof") and the whole
pipeline (auth, alert CRUD, cron worker, Web Push) is live in production. This step
adds the second V1 feature: letting a user create/view/edit/enable/disable/delete
graph reminders (spec section 16), reusing every pattern already established for price
alerts. The `graph_reminders` table and its evaluation logic already exist and are
already running in production (built during Step 2) — this step is UI + one shared
logic extraction, not new backend architecture.

### Decisions

- **Extract `computeNextTriggerAt` into a shared package** — it currently lives only
  in `supabase/functions/tick/nextTrigger.ts` (Deno-only). Move the real implementation
  to `packages/alert-engine/src/computeNextTriggerAt.ts` (same package as
  `evaluatePriceAlert` — both are pure, I/O-free, tested functions; no new package
  needed). Update `supabase/functions/tick/index.ts` to import it via the same
  relative-path pattern already used for `evaluatePriceAlert`
  (`../../../packages/alert-engine/src/computeNextTriggerAt.ts`), and delete the
  duplicate implementation from `supabase/functions/tick/nextTrigger.ts` — do not
  leave two copies. Move `nextTrigger.test.ts`'s test cases to
  `packages/alert-engine/src/__tests__/computeNextTriggerAt.test.ts` (Vitest, not
  Deno's test runner) so they run in the same `pnpm test` suite as everything else.
  Preserve the exact signature and behavior — do not change what "next boundary" means
  for 15m/1H/4H/1D while moving it.
- **Validation** (`packages/validation/src/graphReminder.ts`, new): `createGraphReminderSchema`/
  `updateGraphReminderSchema` — `timeframe` enum `15m|1H|4H|1D` (already defined in
  `packages/validation/src/enums.ts` — reuse it, don't redefine), `description`
  optional free text, `timezone` must be a valid IANA zone (validate with
  `Intl.supportedValuesOf('timeZone').includes(value)` — do not accept an arbitrary
  string), `enabled` boolean. No `trigger_mode`/`direction`/`target_price` — those are
  price-alert-only concepts, reminders always recur on their timeframe by design (spec
  section 16), this is not an ambiguity to flag.
- **UI pages** (mirror the existing price-alert pages under `apps/web/app/dashboard/`):
  `reminders/page.tsx` (list — timeframe, description, next occurrence, enabled
  status, per-row Edit/Enable-Disable/Delete), `reminders/new/page.tsx` (create form —
  timeframe dropdown, description, timezone defaulting to the browser's detected zone
  via `Intl.DateTimeFormat().resolvedOptions().timeZone` but editable), 
  `reminders/[id]/edit/page.tsx` + an edit-form client component (mirror
  `alerts/[id]/edit/edit-form.tsx`'s pattern). Instrument is fixed to XAUUSD, same as
  price alerts — no instrument picker.
- **Server actions** (`apps/web/app/dashboard/reminder-actions.ts`, new, mirroring
  `dashboard/actions.ts`'s pattern exactly): `createReminderAction`,
  `updateReminderAction`, `setReminderEnabledAction`, `deleteReminderAction` — all
  derive `user.id` from the session (never client-supplied), all add an explicit
  `.eq("user_id", user.id)` filter on top of RLS (the defense-in-depth pattern Richard
  has required twice now — do not regress on this). On create, and on update if
  `timeframe` or `timezone` changed, compute `next_trigger_at` using the now-shared
  `computeNextTriggerAt` and store it — the reminder must have a correct
  `next_trigger_at` the moment it's saved, not wait for the next cron tick to notice.
- **Dashboard nav**: add a simple link/tab between "Alerts" and wherever a Reminders
  section belongs on the existing dashboard so both lists are reachable — a small
  addition to `apps/web/app/dashboard/page.tsx` or a shared layout, your call on the
  simplest way that doesn't restructure the existing alerts UI.

### Build Order
1. Extract `computeNextTriggerAt` to `packages/alert-engine`, move its tests, delete
   the Deno-local duplicate, update `tick/index.ts`'s import.
2. `packages/validation/src/graphReminder.ts` + unit tests (valid/invalid timeframe,
   valid/invalid IANA timezone, optional description).
3. `reminders/page.tsx`, `reminders/new/page.tsx`, `reminders/[id]/edit/page.tsx` +
   edit-form component.
4. `dashboard/reminder-actions.ts` (the four server actions).
5. Dashboard nav link between Alerts and Reminders.
6. `apps/web/e2e/reminder-crud.spec.ts` (Playwright) — sign up (or reuse the existing
   alert-crud spec's pattern), create a reminder, see it listed, edit it, delete it.

### Flags
- Flag: Do not duplicate `computeNextTriggerAt` — one implementation, imported by both
  the web app and the Edge Function. If you find a reason the shared version can't work
  identically in both environments, stop and escalate rather than forking it.
- Flag: `packages/validation/src/enums.ts` already has the `timeframe` enum — reuse it.
- Flag: You now have live access to the real Supabase project (unlike Steps 1-2's
  blocked state) — verify the CRUD flow for real against it, not just locally, since
  nothing is blocking that anymore.

### Definition of Done
- [ ] `pnpm build`, `pnpm test`, `pnpm typecheck` pass at repo root, including moved
      `computeNextTriggerAt` tests and new validation tests.
- [ ] `supabase/functions/tick/nextTrigger.ts`'s duplicate implementation is gone;
      `tick/index.ts` imports the shared one.
- [ ] Live-verified against the real Supabase project: sign in, create/edit/enable/
      disable/delete a graph reminder, confirm `next_trigger_at` is set correctly on
      create and recomputed correctly when timeframe/timezone changes.
- [ ] Playwright e2e test passes.
- [ ] RLS/defense-in-depth confirmed on every new query (Richard will check this).

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

Background run — proceeding straight to build per Arch's dispatch note. Plan recorded
here for the record; nothing below hits a Flag or an Escalate-to-Arch trigger.

**1. Extract `computeNextTriggerAt`**
- Move `supabase/functions/tick/nextTrigger.ts`'s implementation verbatim to
  `packages/alert-engine/src/computeNextTriggerAt.ts`, export it from
  `packages/alert-engine/src/index.ts` (alongside the existing
  `evaluatePriceAlert` re-export).
- Move `nextTrigger.test.ts`'s 8 cases to
  `packages/alert-engine/src/__tests__/computeNextTriggerAt.test.ts`, translated from
  bare `Deno.test`/manual-assert to `describe`/`it`/`expect` (Vitest), matching the
  style already used in `evaluatePriceAlert.test.ts` (same directory, same import
  convention: `from "../computeNextTriggerAt.js"`).
- Delete `supabase/functions/tick/nextTrigger.ts` and `nextTrigger.test.ts` — no
  duplicate left behind.
- Update `supabase/functions/tick/index.ts`'s import to
  `../../../packages/alert-engine/src/computeNextTriggerAt.ts`, same relative-path
  pattern already used for `evaluatePriceAlert`. No behavior change — pure move.

**2. Validation package**
- New `packages/validation/src/graphReminder.ts`: `createGraphReminderSchema` /
  `updateGraphReminderSchema`, reusing `reminderTimeframeSchema` from
  `./enums.ts`. `timezone`: `z.string().refine(v => Intl.supportedValuesOf("timeZone").includes(v))`.
  `description`: optional/nullable trimmed string (cap at 500 like price alert's
  `message`, for consistency — not specified in brief, flagging as a small
  Builder default). `enabled`: boolean, default `true` on create.
  No `instrument_id` in the schema (mirrors price alert's update schema omitting
  it) — instrument is always resolved server-side to XAUUSD.
- Export from `packages/validation/src/index.ts`.
- Unit tests in `packages/validation/src/__tests__/graphReminder.test.ts`: valid
  timeframe values, rejected bogus timeframe, valid IANA timezone (e.g.
  `Asia/Kuala_Lumpur`, `UTC`), rejected bogus timezone string, optional
  description (present/absent/empty both fine).

**3. Server actions** (`apps/web/app/dashboard/reminder-actions.ts`, new file,
mirroring `actions.ts` structurally but not sharing code with it — same as how
`actions.ts`/`device-actions.ts` are already separate files today):
- `createReminderAction`, `updateReminderAction` (both `useFormState`-shaped,
  `{error?: string}`), `setReminderEnabledAction`, `deleteReminderAction` (both
  plain `FormData -> void` mirroring `setAlertEnabledAction`/`deleteAlertAction`).
- Each derives `user.id` from `supabase.auth.getUser()`, never trusts client
  input for it; every query adds `.eq("user_id", user.id)` on top of RLS.
- `createReminderAction` resolves the XAUUSD instrument id the same way
  `getXauUsdInstrumentId` does in `actions.ts` (small local copy of that helper —
  not extracting a shared util since the brief doesn't ask for that and the two
  action files are already independent), computes `next_trigger_at` via
  `computeNextTriggerAt(timeframe, timezone, new Date())`, and inserts.
- `updateReminderAction` re-fetches nothing extra: it always recomputes
  `next_trigger_at` when `timeframe` or `timezone` in the submitted form differs
  from the current row's stored values (fetch-before-update, compare, then
  conditionally recompute) — since the form is a full edit form (not partial
  PATCH), the simplest correct rule is "recompute whenever either field's
  submitted value differs from the existing row," per the brief's "on update if
  timeframe or timezone changed."

**4. UI pages** (mirroring `apps/web/app/dashboard/alerts/*`):
- `apps/web/app/dashboard/reminders/page.tsx` — server component, table columns:
  Timeframe, Description, Next occurrence (`next_trigger_at` formatted via the
  same `toLocaleString()` helper style as the alerts list), Status badge,
  Actions (Edit / Enable-Disable / Delete), same table/badge/actions CSS classes
  already in `globals.css` (no new CSS needed for the list).
- `apps/web/app/dashboard/reminders/new/page.tsx` — client form: timeframe
  `<select>` (15m/1H/4H/1D), description `<textarea>` optional, timezone text
  input defaulting to the browser's detected zone. To avoid an SSR/client
  hydration mismatch (server has no meaningful "browser timezone"), the input
  starts as an empty controlled value and is populated via `useEffect` after
  mount with `Intl.DateTimeFormat().resolvedOptions().timeZone` — same
  zero-mismatch pattern as any client-only default. Still editable/required
  before submit.
- `apps/web/app/dashboard/reminders/[id]/edit/page.tsx` +
  `edit-form.tsx` — same shape as `alerts/[id]/edit/`, pre-filled from the
  fetched row (`defaultValue`s, no hydration concern since these are real
  server-fetched values, not client-detected ones).
- Instrument is not shown as a form field anywhere (fixed to XAUUSD per brief);
  the list table does show an "Instrument" column (XAUUSD) for parity with the
  alerts list, since the underlying row still has `instrument_id`.

**5. Dashboard nav**
- Simplest option that touches the least: on `dashboard/page.tsx`'s existing
  `top-bar .actions` row, add a `<Link className="btn btn-secondary" href="/dashboard/reminders">Reminders</Link>`
  next to "New alert"/"Log out". On the new `reminders/page.tsx`'s equivalent
  top bar, add the mirror-image `<Link ... href="/dashboard">Alerts</Link>`. No
  new CSS classes, no shared layout/nav component — each page just links to the
  other, which is enough for "both lists are reachable" without restructuring
  the existing alerts UI.

**6. E2E test** — `apps/web/e2e/reminder-crud.spec.ts`, same sign-up-fresh-user
structure as `alert-crud.spec.ts`: sign up, create a reminder (timeframe +
description), see it listed, edit it (change description, assert new text
shown), delete it, assert gone.

**Open items / small Builder defaults (flagging, not blocking):**
- Capping `description` at 500 chars — not specified in the brief; matching
  price alert's `message` cap for consistency. Will change if Arch/Richard wants
  unlimited or a different cap.
- Platform quirk found while implementing the timezone validator: the brief's
  literal `Intl.supportedValuesOf("timeZone").includes(value)` check rejects
  `"UTC"` — Node/ECMA-402 doesn't enumerate the bare `"UTC"` alias in that
  list (it resolves to `Etc/UTC`), even though `Intl.DateTimeFormat` itself
  accepts `"UTC"` as a `timeZone` fine. This matters because `"UTC"` is the
  `graph_reminders.timezone` column's own DB default. Resolved by special-
  casing `value === "UTC"` in addition to the `supportedValuesOf` check
  (`packages/validation/src/graphReminder.ts`) rather than escalating — the
  correct behavior here isn't a judgment call (UTC is unambiguously a valid
  timezone), just a gap in what that one API enumerates.
- "Recompute next_trigger_at when timeframe or timezone changed" is implemented
  as "recompute whenever the submitted value differs from the current row,"
  evaluated inside `updateReminderAction` before the `.update()` call.

Architect approval: [ ] Approved / [ ] Redirect — see notes below
