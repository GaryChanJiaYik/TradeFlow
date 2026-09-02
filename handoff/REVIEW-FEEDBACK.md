# Review Feedback — Step 6
Date: 2026-09-02
Ready for Builder: YES

## Must Fix
None.

## Should Fix
- `supabase/functions/tick/index.ts` (`processPriceAlerts`, `processGraphReminders`) —
  the proof that the update-before-push ordering holds under real failure is manual
  and ephemeral (local Docker stack, torn down after use). There's no committed
  automated test (e.g. a mocked `SupabaseClient` returning `{ error }` truthy on the
  `price_alerts`/`graph_reminders` update) that would catch a future regression of
  this ordering in CI. Recommend adding one — low effort, and this is exactly the
  kind of control-flow invariant that's easy to silently break in a later edit.
- Verification only force-failed one of the three lower-severity writes
  (`notification_log` insert). The device-disable update (~line 128) and the
  `instruments.last_price` update (~line 356) were not independently forced to fail —
  justified in BUILD-LOG as "identical code pattern to the one just proven." I agree
  the pattern is structurally identical (checked by code read, see Cleared below) so
  this isn't a blocker, but it's worth naming explicitly as an accepted verification
  gap rather than letting "all three lower-severity writes were forced-failed" be
  assumed from the report.

## Escalate to Architect
None.

## Cleared

**1. Ordering / no-fallthrough check (processPriceAlerts, processGraphReminders).**
Read both functions in full. In `processPriceAlerts` (lines 220-262 of the current
file): `evaluatePriceAlert` gate at line 220 (`continue` if false) → `triggered++` →
the `price_alerts` update at line 231 → `if (updateError) { console.error(...);
continue; }` at 232-235 → only then the direction-wording, `pushToUserDevices` call
(249), and `logNotification` call (255). No code path reaches the push after a failed
update — the `continue` is unconditional on error, no other branch skips it. Same
shape in `processGraphReminders` (lines 291-311): `computeNextTriggerAt` →
`graph_reminders` update (297) → `if (updateError) { console.error(...); continue;
}` (301-304) → then `pushToUserDevices` (306) and `logNotification` (312). Confirmed
via `git diff HEAD -- supabase/functions/tick/index.ts` that the `graph_reminders`
update block was moved earlier in the function (previously ran after the push/log)
rather than duplicated or left in both places.

**2. Three lower-severity writes.** All three now check `error` and `console.error`
on failure, no control-flow change, matching the report:
- `logNotification`'s `notification_log` insert (lines 168-182) — error checked,
  logged, function still returns normally.
- `pushToUserDevices`'s device-disable update (lines 128-134) — `disableError`
  checked, logged; the outer per-device loop is unaffected either way.
- Main handler's `instruments.last_price`/`last_price_at` update (lines 356-362) —
  `instrumentUpdateError` checked, logged; no branching added.

**3. Business logic untouched.** `git diff HEAD -- supabase/functions/tick/index.ts`
against commit `925a612` (last commit to touch this file) shows only: (a) the two
update blocks reordered/relocated, (b) `error`-destructuring plus an `if (error)
console.error(...)` added at five call sites, (c) a `continue` added at the two
duplicate-risk sites. The `evaluatePriceAlert(...)` call, its arguments, the
crossed-up/down wording logic, and the `computeNextTriggerAt(reminder.timeframe,
reminder.timezone, now, buildReminderWindowArg(reminder))` call and its arguments are
byte-for-byte identical to before — the diff hunk for the reminder update shows it as
a pure cut-and-paste (removed from its old position, added earlier, no line inside it
changed). No business-logic drift.

**4. Verification method assessment.** REVOKE-based forced failure against a real
local Postgres/Supabase stack is a legitimate and, for this specific fix, a *better*
proof than a read-through or a mock: `supabase-js` doesn't throw on failure, so the
bug this step fixes is entirely about whether code correctly branches on a populated
`error` field — REVOKE produces a genuine `42501` on the exact statement in question,
which is indistinguishable in shape from any other real write failure the fix is
meant to handle (network blip, RLS misconfig, connection exhaustion, etc.), and the
before/after DB-state check (0 rows / correct final state, then exactly one row per
event with no duplicates after re-granting) is the right thing to assert — it directly
tests the duplicate-notification risk the step exists to close, not just "did the
function not crash." I don't think a mocked unit test replaces this for initial proof
of the fix; I do think one should exist going forward for regression protection (see
Should Fix above) — that's a complement, not a substitute.

**5. RLS/auth regression check.** Single `createClient(...)` call in the file (main
handler, using `SUPABASE_SERVICE_ROLE_KEY`), unchanged by this diff and unchanged in
purpose — this file's whole reason for using the service-role client (no logged-in
user in a cron context) predates this step and nothing here shifts additional logic
onto it inappropriately. No other client instantiation in the file. No new tables or
RLS-sensitive access introduced. No regression.

**Overall**: reviewed the full current `supabase/functions/tick/index.ts` and diffed
it against the last commit that touched it. The fix is exactly what was claimed — a
pure control-flow/error-handling change, correctly ordered, with no fallthrough after
a failed state-changing write and no business-logic drift. Step 6 is clear.
