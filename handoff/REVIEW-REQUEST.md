# Review Request — Step 5: Fix reminder timezone display bug + add configurable market-open/close window
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

**Re-submission note (2026-09-01):** Richard's first pass (`handoff/REVIEW-FEEDBACK.md`,
`Ready for Builder: YES`) had no Must Fix and one Should Fix: the new window tests only
exercised a non-DST zone (`Asia/Kuala_Lumpur`), unlike the pre-existing no-window suite's
US DST fall-back test — an asymmetry in rigor between the two suites. Addressed: added
one test to `computeNextTriggerAt.test.ts` mirroring that exact DST transition
(America/New_York, 2026-11-01 fall-back) with an overnight window applied, hand-derived
against the same transition instant as the existing no-window test before writing the
assertion. It passes as expected — confirms Richard's own reasoning that the window
helpers only do wall-clock-minutes arithmetic ahead of the same DST-safe
`zonedWallClockToUtc` conversion the no-window branches already use, so there's no
separate DST-sensitive path in the window branch. No bug found; no change to
`computeNextTriggerAt.ts` itself. Full derivation in the test's own comment and in
`handoff/BUILD-LOG.md`'s Step 5 entry. `pnpm build`/`pnpm test`/`pnpm typecheck` re-run
clean at repo root (32 alert-engine [was 31], 37 validation, 12 market-data; 8/8
packages typecheck; `web` build green). Nothing else changed from the first submission.

---

## Context

Two related, owner-reported issues with graph reminders (both live in production),
per `handoff/ARCHITECT-BRIEF.md`'s Step 5:

1. **Display bug**: "Next occurrence" on `/dashboard/reminders` showed the wrong wall
   time (e.g. a 15m reminder computed for 2:00pm Malaysia time displayed as "6:00 AM").
   Root cause: `formatDate()` called `toLocaleString()` with no `timeZone` option, on a
   Server Component running on Cloudflare Workers (UTC-default runtime) — the *stored*
   value was always correct.
2. **Feature**: an optional per-reminder market-open/close window
   (`window_start_time`/`window_end_time`) that anchors and restricts the
   15m/1H/4H/1D periodic grid, instead of always anchoring to local midnight
   unrestricted.

This touches `computeNextTriggerAt`, already running live in production every 2
minutes via the `tick` Edge Function — treated with matching test rigor. Builder Plan
(written and left in place per BUILDER.md, background run):
`handoff/ARCHITECT-BRIEF.md`'s Builder Plan section, including two flagged
deviations/additions from the brief's literal text (see "Open Questions" below).
Full detail of what was verified: `handoff/BUILD-LOG.md`'s new "Step 5" entry.

This session had **no** live-DB access for anything requiring the new migration's
columns (network blocks `supabase db push`, per KG-8) — DB-layer verification used a
throwaway local `supabase start` Docker stack instead; see "Verified" below.

## What Was Changed

### `packages/alert-engine/src/computeNextTriggerAt.ts` (+~90 lines)
- Added optional 4th param `window?: { startMinutes: number; endMinutes: number }`
  (plain numbers — no string parsing in this function, per the brief's Flags).
  Pre-existing no-window code path left byte-for-byte untouched, behind an early
  `if (window) { ...; return ...; }` — the original 9 tests are a zero-risk
  regression proof, unchanged.
- New `minutesToNextPeriodicOccurrence` (15m/1H/4H) and `minutesToNextDailyOccurrence`
  (1D) helpers implement the window-anchored arithmetic, using `1440 - offset`
  uniformly for "rolled off the last in-window slot" and "currently outside the
  window." **Note**: this differs from the brief's suggested rollover expression
  (`(windowLength - offset + 1440) % 1440`), which does not reproduce the brief's own
  overnight-window worked example — see "Open Questions" #1 below for the full
  reasoning; re-derived and verified by hand against all three worked examples before
  writing any test.
- 1D-with-window also deviates from the brief's literal "same floor-then-always-+1-day
  structure" wording — see "Open Questions" #2.

### `packages/alert-engine/src/__tests__/computeNextTriggerAt.test.ts` (+~130 lines, 9 → 24 tests)
All three of the brief's worked examples as literal cases with matching expected
values, exact-window-end-instant exclusion, well-outside-window, an explicit
`undefined`-window no-op check, both no-window regression cases re-asserted, three
1D-with-window cases, one window case in `Asia/Kuala_Lumpur` (confirms the window logic
composes with the existing DST-safe conversion rather than replacing it), and — added in
response to Richard's Should Fix — one overnight-window case across the same US DST
fall-back transition the pre-existing no-window suite already covers
(America/New_York, 2026-11-01), closing the DST-rigor gap between the two suites.

### `supabase/functions/tick/index.ts` (+~30 lines) — scope addition, see Open Questions #3
`processGraphReminders` also calls `computeNextTriggerAt` to recompute
`next_trigger_at` after each fire. Not in the brief's Build Order, but leaving it
unfixed would mean a windowed reminder's schedule silently reverts to
unrestricted/midnight-anchored after its first firing. Added
`timeStringToMinutes`/`buildReminderWindowArg` helpers (mirrors
`reminder-actions.ts`'s equivalent — duplicated per the existing per-environment
convention, not extracted into a shared util) and wired the window through.
Typechecked with `deno check index.ts` (Deno 2.9.6) — outside `pnpm typecheck`'s
Node-only scope.

### `supabase/migrations/0004_reminder_window.sql` (new, 25 lines)
Adds `window_start_time time null` / `window_end_time time null` to
`graph_reminders`, plus `CHECK ((window_start_time IS NULL) = (window_end_time IS NULL))`.
**Not applied to the live project** — see "Verified" and "Not Attempted" below.

### `packages/validation/src/graphReminder.ts` (+~40 lines)
`withWindowFields` wrapper shared by `createGraphReminderSchema`/
`updateGraphReminderSchema`: optional `window_start_time`/`window_end_time`
(`"HH:MM"`), `.refine()` for both-or-neither (mirrors the DB CHECK — defense in
depth), `.transform()` normalizing equal start/end to `null`/`null` (per the owner's
"6am to 6am the next day is equivalent to no set" framing) and normalizing the
omitted-both case to explicit `null`/`null` too, for one consistent representation.

### `packages/validation/src/__tests__/graphReminder.test.ts` (+~75 lines, 9 → 28 tests)
Both omitted, both null, both valid/distinct, overnight-wrapping window, one-of-two
set (both directions, rejected), malformed/out-of-range time strings,
equal-times-normalizes-to-null, and the same rule on `updateGraphReminderSchema`.

### `packages/types/src/graphReminder.ts` (+4 lines)
`GraphReminder` interface: `window_start_time`/`window_end_time: string | null`.

### `apps/web/app/dashboard/reminder-actions.ts` (+~50 lines)
`readReminderFormFields` reads the two new fields (empty string → `null`, matching
the existing `description` pattern). New `timeStringToMinutes`/`buildWindowArg`
helpers convert to `computeNextTriggerAt`'s window arg. `updateReminderAction`'s
existing `scheduleChanged` guard extended to also compare the window fields, via a
new `normalizeTimeForCompare` (DB's `"HH:MM:SS"` → `"HH:MM"`) so an unrelated edit
doesn't spuriously trigger a recompute.

### `apps/web/app/dashboard/reminders/new/new-reminder-form.tsx` and
`.../[id]/edit/edit-form.tsx` (+~15 lines each)
Two optional `<input type="time">` fields ("Market open"/"Market close") plus a
one-line explanation. Edit form slices the DB's `"HH:MM:SS"` default down to
`"HH:MM"`.

### `apps/web/app/dashboard/reminders/page.tsx` (~10 lines changed)
`formatDate` now takes the reminder's `timezone` and passes it to
`toLocaleString`'s `timeZone` option (plus `dateStyle: "medium"`/`timeStyle: "short"`)
— the display bug fix.

No other files touched. `handoff/ARCHITECT-BRIEF.md`'s Builder Plan section was
added per BUILDER.md's process before building.

## Verified

- `pnpm build`, `pnpm test`, `pnpm typecheck` at repo root — all green. Test counts:
  32 alert-engine (was 8), 37 validation (was 9), 12 market-data (unchanged). `web`'s
  production build compiles, typechecks, and generates all 11 routes.
- `deno check supabase/functions/tick/index.ts` — clean.
- **Migration, local-only**: `npx supabase start` + `npx supabase db reset` against a
  throwaway Docker stack applied all four migrations (`0001`-`0004`) cleanly in
  order. `\d public.graph_reminders` confirmed both new nullable `time` columns and
  the CHECK constraint exist exactly as written. A direct SQL `INSERT` with only
  `window_start_time` set correctly raised
  `violates check constraint "graph_reminders_window_both_or_neither"`; a valid
  both-set `INSERT` succeeded and round-tripped `06:00:00`/`22:00:00` correctly.
  Stack torn down after (`npx supabase stop`); `git status` confirms no stray files
  from this — never touched the real project.

## Not Attempted

- **No live verification against the real Supabase project for anything needing the
  new columns.** The live `graph_reminders` table doesn't have
  `window_start_time`/`window_end_time` yet — any create/edit of a windowed reminder
  against production would fail with a PostgREST "column does not exist" error.
  Per this session's explicit instructions, did not attempt `supabase db push`
  (would hang — same network block as KG-8) and did not run the existing
  `reminder-crud.spec.ts` e2e spec against the live project (it doesn't touch the new
  fields so it would likely still pass, but running any live write felt like
  unnecessary risk mid-migration).
- Brief's Step 5 Build Order step 6 (live verification: create a windowed reminder,
  confirm `next_trigger_at` matches a hand-computed expectation, confirm the display
  fix) is entirely pending Arch applying `0004_reminder_window.sql` via the dashboard
  SQL Editor.
- Not deployed to the live Cloudflare Workers site — same "no deploy credentials this
  session" constraint as Steps 3/4 (see KG-11).

## Open Questions

1. **1D-with-window formula deviates from the brief's literal wording.** The brief
   says: "the single daily occurrence's minute-of-day is `window.startMinutes`
   instead of `0`... same 'floor to today's occurrence time, then add one day'
   structure as the existing no-window 1D branch." Taken completely literally, that
   would mean: always compute today's date at `startMinutes`, then unconditionally
   add 24h — which incorrectly skips *today's* still-upcoming occurrence whenever
   `startMinutes` is later in the day than `from`'s current wall time (e.g. anchor
   `10:00`, `from = 08:00` should give *today* `10:00`, not tomorrow `10:00`).
   Implemented instead as `1440 - offset` against the anchor (same mechanism as the
   periodic branches), which reduces algebraically to the existing untouched
   `startMinutes = 0` behavior (so the existing 1D tests double as a correctness
   check of the generalization), and gives the intuitively-correct answer for
   `startMinutes != 0`. No worked example was given for this branch in the brief —
   please confirm this is the intended behavior.
2. **The brief's own suggested rollover formula for periodic windows
   (`(windowLength - offset + 1440) % 1440`) does not reproduce the brief's own
   overnight-window worked example.** With `window = 22:00-06:00`, `from = 05:30`
   (`offset = 450`, `windowLength = 480`): that formula gives `30` minutes → `06:00`
   (the window's own end, which should never itself be a valid occurrence), while the
   brief's stated expected answer is a roll to `22:00`. Used `1440 - offset`
   instead (`= 990` → `22:00`, matching). Re-derived by hand against all three worked
   examples rather than adjusting the test to match a formula that didn't reproduce
   them, per this session's instructions. Flagging in case the brief intended
   something else that I've misread.
3. **`supabase/functions/tick/index.ts` scope addition** — not in the brief's Build
   Order/Definition of Done, but without this fix a windowed reminder's schedule
   would silently revert to unrestricted after its first firing (the `tick` function
   recomputes `next_trigger_at` after every fire, and previously called
   `computeNextTriggerAt` without a window arg at all). Treated as in-scope and fixed
   rather than deferred — confirm that was the right call.

## Known Gaps Logged

- **KG-12** (`handoff/BUILD-LOG.md`) — `0004_reminder_window.sql` is written but not
  applied to the live project; same network constraint as KG-8. Blocks Step 5's live
  verification (Build Order step 6) until Arch applies it via the dashboard SQL
  Editor.

Ready for Review: YES
