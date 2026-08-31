# Review Feedback — Step 3
*Written by Reviewer. Read by Builder and Architect.*

Date: 2026-08-31
Ready for Builder: YES

---

## Must Fix
[Blocks the step. Bob fixes before anything moves forward.]

None.

## Should Fix
[Does not block. Fix inline if under 5 minutes, otherwise log to BUILD-LOG.]

- `packages/validation/src/graphReminder.ts:9-14` (comment above
  `isValidIanaTimeZone`) — the comment says `"UTC"` "resolves to" `Etc/UTC`
  in the tzdb and implies `Etc/UTC` is one of the values
  `Intl.supportedValuesOf("timeZone")` enumerates. Checked directly (Node
  24.19.0): `Intl.supportedValuesOf("timeZone")` does not contain `Etc/UTC`
  either — there are no `Etc/*` entries in the list at all on this runtime,
  even though `new Intl.DateTimeFormat(undefined, { timeZone: "Etc/UTC" })`
  is accepted fine. Doesn't change behavior or create a security/logic gap
  (the code doesn't rely on `Etc/UTC` being in the list — it only
  special-cases the bare string `"UTC"`, which is exactly what was needed),
  just a comment claim that isn't accurate on this runtime. Reword to drop
  the "resolves to Etc/UTC, which the list does carry" implication.

## Escalate to Architect
[Product or business decision required — not a code decision.]

None.

## Cleared

- **`computeNextTriggerAt` extraction** — diffed
  `packages/alert-engine/src/computeNextTriggerAt.ts` against the deleted
  `supabase/functions/tick/nextTrigger.ts` at its last commit (`git show
  0df58cd:supabase/functions/tick/nextTrigger.ts`). The entire function body
  (`getWallClock`, `zonedWallClockToUtc`, `computeNextTriggerAt`, and the
  `TIMEFRAME_MINUTES` table) is byte-for-byte identical. The only textual
  difference is the local `export type ReminderTimeframe = "15m" | "1H" |
  "4H" | "1D"` being replaced with `import type { ReminderTimeframe } from
  "@tradeflow/types"` plus an added doc-comment paragraph — confirmed
  `packages/types/src/enums.ts:10` defines the exact same union, so this is
  a pure relocation, not a drifted reimplementation. Confirmed both
  `supabase/functions/tick/nextTrigger.ts` and `nextTrigger.test.ts` are
  actually deleted (`git status` shows `D`, not present on disk), and
  `supabase/functions/tick/index.ts:29` imports the shared file via the same
  relative-path pattern already used for `evaluatePriceAlert`
  (`../../../packages/alert-engine/src/computeNextTriggerAt.ts`) and calls
  it at line 243 inside `processGraphReminders` — no duplicate
  implementation left anywhere. `packages/alert-engine/src/index.ts` now
  re-exports it alongside `evaluatePriceAlert`. The translated test file
  (`packages/alert-engine/src/__tests__/computeNextTriggerAt.test.ts`) keeps
  the same 9 cases (UTC boundary floor/advance for 15m/1H/4H/1D, a fixed
  +8 zone for 1D and 4H, a US DST fall-back case, and the future-instant
  sanity check) — read in full, no coverage silently dropped in the
  translation. `pnpm -w test` at repo root: all 6 workspace packages pass
  (alert-engine 17, validation 27, market-data 12, plus web build/typecheck),
  matching Bob's claimed count. `pnpm --filter web typecheck` also clean.

- **UTC timezone special case** — `isValidIanaTimeZone` in
  `packages/validation/src/graphReminder.ts:20-22` is `value === "UTC" ||
  Intl.supportedValuesOf("timeZone").includes(value)`, i.e. exact
  case-sensitive equality to the literal string `"UTC"`, not a prefix/regex
  match that could widen acceptance. Verified directly against the actual
  runtime (Node 24.19.0, matches what the app runs on):
  `Intl.supportedValuesOf("timeZone")` does not contain `"UTC"`, `"utc"`, or
  `"Etc/UTC"` — confirms Bob's claimed platform quirk is real, not
  fabricated. Ran the validator function against real invalid/edge inputs:
  `"utc"` (lowercase) → **rejected**, `"Etc/UTC"` → rejected (a false
  negative for a technically-valid zone, but not a widening — see Should Fix
  above), `"UTC"` → accepted, and genuinely bogus strings `"Not/A_Zone"`,
  `"GMT+8"`, `"Nonsense/Timezone"` → all **rejected**. The existing test
  suite (`packages/validation/src/__tests__/graphReminder.test.ts`) also
  covers a bogus zone and a fixed-offset-style string as separate rejection
  cases, and both create/update schemas share the same `timezoneSchema`, so
  the special case can't be accidentally bypassed via one code path. This is
  a narrow, correctly-scoped workaround for a real platform gap, not a
  validation loophole.

- **`reminder-actions.ts` authorization pattern** — read the full file
  (`apps/web/app/dashboard/reminder-actions.ts`) and compared it line-by-line
  against the already-cleared `apps/web/app/dashboard/actions.ts` (Step 1).
  Every one of the four actions (`createReminderAction`,
  `updateReminderAction`, `setReminderEnabledAction`,
  `deleteReminderAction`) calls `supabase.auth.getUser()` and redirects to
  `/login` if absent, uses only the resulting `user.id` (never a client-
  supplied field) for `user_id`, and every `select`/`update`/`delete` on
  `graph_reminders` chains an explicit `.eq("user_id", user.id)` on top of
  RLS — matching the Step 1 pattern exactly (`updateReminderAction`
  additionally fetches the existing row scoped by `id` **and** `user_id`
  before recomputing, which is at least as strict as Step 1's
  `updateAlertAction`, not looser). The two server-component pages
  (`reminders/page.tsx:28`, `reminders/[id]/edit/page.tsx:19-20`) apply the
  same `.eq("user_id", user.id)` filter when fetching for display/edit
  pre-fill. No path found where a reminder ID from form input or the URL
  param is used without a `user_id` filter alongside it.

- **`next_trigger_at` computation** — `createReminderAction` computes it
  via `computeNextTriggerAt(parsed.data.timeframe, parsed.data.timezone,
  now)` and includes it directly in the insert payload (not left for the
  first cron tick to fill in). `updateReminderAction` fetches the existing
  `timeframe`/`timezone`, compares against the submitted values, and only
  recomputes/overwrites `next_trigger_at` when either actually changed —
  an edit that only touches `description`/`enabled` leaves the existing
  schedule alone, which is correct (recomputing unconditionally from "now"
  on every edit would silently reset/delay a user's schedule for
  unrelated edits). Matches Bob's live-DB verification claims in
  `REVIEW-REQUEST.md` (1H/Asia/Kuala_Lumpur create matched to the
  millisecond; timeframe+timezone change on update recomputed correctly) —
  not independently re-run against the live project this round (no live
  Supabase access from this review), but the code path matches exactly what
  was described and is internally consistent with the schema/action code.

- **Validation tests non-tautological** — read
  `packages/validation/src/__tests__/graphReminder.test.ts` in full (18
  cases). Each asserts a real accept/reject outcome against realistic input
  (valid timeframes, an invalid timeframe, valid IANA zones including UTC,
  a bogus zone, a fixed-offset string, missing/null/empty/over-length
  description, create's `enabled` default vs. update's required `enabled`)
  — none simply re-assert a hardcoded value against itself.

- **E2E spec exercises real CRUD** — read
  `apps/web/e2e/reminder-crud.spec.ts` in full: signs up a fresh user,
  navigates via the real "Reminders" nav link, creates a reminder through
  the real form, asserts it appears in the list with the correct timeframe,
  edits the description through the real edit form, asserts the list
  reflects the change, deletes it, and asserts the row is gone. Exercises
  the actual `reminder-actions.ts` server actions end-to-end through the UI,
  not a mocked shortcut — same structure as the already-cleared
  `alert-crud.spec.ts`.

- **Nav / dependency wiring** — `apps/web/app/dashboard/page.tsx` diff is
  exactly the claimed +3 lines (a "Reminders" link in the top-bar actions
  row). `apps/web/package.json` gained exactly one new dependency line
  (`@tradeflow/alert-engine: workspace:*`), and `pnpm-lock.yaml`'s diff is
  exactly 3 added lines resolving that new workspace link — no unrelated
  lockfile churn. `git status` shows only the files Bob's Files Changed list
  describes (no undisclosed drift into other files).

**Step 3 is clear**, aside from the one cosmetic comment-wording nit above (Should Fix, non-blocking).
