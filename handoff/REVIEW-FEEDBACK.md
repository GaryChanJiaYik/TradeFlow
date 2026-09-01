# Review Feedback — Step 5
Date: 2026-09-01
Ready for Builder: YES

## Must Fix
None.

## Should Fix
- `packages/alert-engine/src/__tests__/computeNextTriggerAt.test.ts` — the new window
  tests only exercise a fixed-offset, non-DST zone (`Asia/Kuala_Lumpur`). The
  pre-existing no-window suite already carries a DST-transition test ("1H across a US
  DST fall-back transition"), which is the established rigor bar for this exact
  function — the window branch doesn't meet it yet. This is not a Must Fix: by
  inspection, the window helpers (`minutesToNextPeriodicOccurrence`,
  `minutesToNextDailyOccurrence`) do pure wall-clock-minutes arithmetic on the value
  `getWallClock` already returns, and the result is handed to the same
  `zonedWallClockToUtc` fixed-point conversion the no-window branches use unchanged —
  there is no separate DST-sensitive code path introduced by the window logic, so the
  existing DST-safety argument for the no-window branches extends to the window branch
  by construction, not by coincidence. Given the product is XAUUSD-only and the
  realistic user base skews to non-DST zones (Asia/Kuala_Lumpur), the practical risk is
  low. Recommend adding one test mirroring the existing DST fall-back case but with a
  `window` arg (e.g. an overnight window in `America/New_York` spanning the Nov 1
  transition), logged to BUILD-LOG if not done inline — closes the coverage gap rather
  than leaving an asymmetry between the window and no-window suites.

## Escalate to Architect
None. Bob's three "Open Questions" are all resolved at the code/arithmetic level (see
Cleared below) — none require a product decision.

## Cleared

**1. Window-arithmetic re-derived independently, from scratch, against the brief's three
worked examples plus additional boundary cases — all match the code and the tests:**
- *06:00–22:00, 4H, from=09:00*: `offset=180`, `currentSlot=0`, `nextSlotOffset=240<960`
  → `+60min` → **10:00 today**. Matches brief and test.
- *06:00–22:00, 4H, from=22:00 exactly (window's own end)*: `offset=960`, not `<
  windowLength(960)` → outside branch → `1440-960=480` → **06:00 next day**. Confirms
  the window end is correctly exclusive (never itself a fireable slot).
- *06:00–22:00, 4H, from=10:00 exactly (a valid slot)*: `offset=240<960`,
  `currentSlot=1`, `nextSlotOffset=480<960` → `+240min` → **14:00 same day** — confirms
  "at a slot" correctly returns the *next* slot, not the same instant (consistent with
  the no-window branches' existing "strictly after `from`" contract).
- *Overnight 22:00–06:00, 1H, from=05:30 (the trickiest case)*: `offset=((330-1320)%1440+1440)%1440
  = 450`, `currentSlot=7`, `nextSlotOffset=480`, not `<480` → rollover →
  `1440-450=990min` → **22:00 same day**. Independently confirms Bob's/Arch's math:
  the brief's own suggested formula `(windowLength-offset+1440)%1440 = (480-450+1440)%1440
  = 30` would give **06:00** — the window's own end, an invalid occurrence — so the
  brief's literal suggestion is wrong and `1440-offset` is correct. I re-derived this
  from the number line myself rather than trusting either party's arithmetic: both
  the "rolled off the last in-window slot" and "currently outside the window" cases are
  measuring distance to the *next window-start* event, which recurs every 1440 minutes
  from the most recent start — i.e. distance to `offset=1440`, which is exactly
  `1440-offset` in both cases. The brief's formula instead measures distance to
  `offset=windowLength` (the window's *end*, mod 1440), which is a different — and
  wrong — target. This isn't a coincidence that both branches share a formula; it's
  because they're the same target event measured the same way.
- *Overnight window, from=06:00 exactly (window's own end)*: `offset=480`, not `<480` →
  outside → `1440-480=960min` → **22:00 same day** (16h later) — correct, matches the
  "window end is exclusive, next start is later today" expectation.

**2. No-window path confirmed a true byte-for-byte no-op by reading the diff, not
trusting the claim**: `git diff HEAD -- packages/alert-engine/src/computeNextTriggerAt.ts`
shows the entire pre-existing function body (the `1D`/periodic non-window branches,
lines ~207–242) is untouched context in the diff — no removed or modified lines, only
additions (new helpers, new interface, and a new `if (window) { ...; return ...; }`
block inserted before the untouched original code). When `window` is `undefined`, that
`if` block is skipped entirely and execution falls through to the exact original code
path. The new "passing `undefined` explicitly" test and the two no-window regression
tests in the test diff pass, and all 9 original test cases are present unchanged and
still pass (31/31 in the full suite, confirmed by running `pnpm --filter
@tradeflow/alert-engine test` myself).

**3. 1D-window generalization verified to reduce to the existing behavior at
`startMinutes=0`, both algebraically and by test**: at `startMinutes=0`,
`offset = ((m-0)%1440+1440)%1440 = m` (since `m` is already in `[0,1440)`), so
`1440-offset = 1440-m` — the exact distance from `from` to *tomorrow's* midnight. The
existing untouched no-window 1D branch computes "floor to today's local midnight, add
24h," which — since today's midnight is always in the past relative to any `m>=0` — is
also always exactly `1440-m` minutes ahead of `from`. The two formulas are identical at
`startMinutes=0` for exactly the reason Bob states, and I confirmed this reduction
holds independent of Bob's own reasoning. The pre-existing 1D test cases ("1D in UTC
advances to the next local midnight", "1D in a fixed +8 timezone…") are present
unchanged in the test diff and pass (confirmed by test run) — they exercise exactly
this reduction. Separately hand-verified the generalization's three new behaviors
(anchor still ahead today → today's occurrence; anchor already passed → tomorrow's;
`from` exactly at the anchor → strictly the *following* day, not now) against the new
1D-window tests — all check out and are internally consistent with how the periodic
branch treats "exactly at a slot."

**4. DST + window interaction** — assessed and flagged above (Should Fix), not a
blocker. See reasoning there.

**5. `supabase/migrations/0004_reminder_window.sql`** — `CHECK ((window_start_time IS
NULL) = (window_end_time IS NULL))` is correct: both-null → `true=true` → passes;
both-set → `false=false` → passes; exactly one set → `true=false` or `false=true` →
fails, correctly rejecting the one-of-two case. This is plain, unremarkable DDL (two
nullable `time` columns + one boolean-equality CHECK) against a table
(`graph_reminders`) that already exists as of `0001_init.sql`, with no dependency on
anything that could plausibly fail on a fresh local stack — Bob's local-verification
claim (clean apply of `0001`–`0004` in order, columns and constraint present, one-sided
insert rejected, both-sided insert round-tripped correctly) is fully consistent with
what the SQL itself says should happen.

**6. Validation schema** (`packages/validation/src/graphReminder.ts`) — traced by hand:
both omitted → both normalize to explicit `null`; both explicit `null` → same; one
set/one absent (both directions) → `refine` fails (`startIsNull !== endIsNull`) →
correctly rejected; both set, distinct (including the overnight-wrapping case, start >
end) → passes through unchanged, since the regex validates format only, not ordering;
both set and equal (e.g. `"09:00"`/`"09:00"`) → `transform` correctly normalizes to
`null`/`null`; malformed (`"6:00"`) or out-of-range (`"25:00"`) strings fail the
per-field regex before the object-level refine/transform ever runs. All of this matches
the new test file's 19 new cases (I read the diff directly, not just the pass/fail
count) and the full 37/37 test run I executed.

**7. `supabase/functions/tick/index.ts` scope addition** — confirmed genuinely
necessary: the `processGraphReminders` query already does `select("*, instruments(symbol)")`
(a wildcard), so `window_start_time`/`window_end_time` will be present on `reminder`
once the migration lands, with no select-list change needed. Before this fix, the
`computeNextTriggerAt` call passed only 3 args (no window) — confirmed by the diff — so
any windowed reminder would have its window silently dropped on every recompute after
its first fire, reverting to unrestricted/midnight-anchored behavior. The added
`timeStringToMinutes`/`buildReminderWindowArg` helpers are straightforward
string-to-minutes conversions mirroring `reminder-actions.ts`'s equivalent, and
`deno check index.ts` (re-run myself, Deno 2.9.6) is clean. Correct call to bring this
in-scope rather than ship a feature that regresses itself within one tick cycle.

**8. Standard checks** — `reminder-actions.ts`'s auth/RLS defense-in-depth pattern
(`.eq("user_id", user.id)` on every read/update/delete, explicit `user_id: user.id` on
insert) is unchanged and present on all the modified action functions, including the
new `existing` fetch added for the window-aware `scheduleChanged` comparison in
`updateReminderAction`. `reminders/page.tsx`'s `formatDate` fix correctly threads the
reminder's own `timezone` column (already fetched via `select("*, ...")`, filtered by
`user_id`) into `toLocaleString`'s `timeZone` option — the only call site, confirmed by
reading the full file, not just the diff.

**General**: `pnpm build`, `pnpm test` (31 alert-engine, 37 validation, all passing —
re-run myself), and `pnpm typecheck` (re-run myself, all 8 workspace packages green)
all corroborate Bob's claims independently rather than trusting the report.
