# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 6 — Reliability hardening: unchecked DB writes risk duplicate notifications

Found during a deliberate hardening pass (spec Phase 17), not owner-reported. Spec
section 35 requires: "Where practical, event handling should be idempotent. Do not
accidentally send multiple notifications for the same event." Section 36 wants
notification failures logged.

**The gap**: `supabase-js` does not throw on a failed `.update()`/`.insert()` — it
returns `{ data, error }`, which the caller must check. `supabase/functions/tick/index.ts`
has several such calls whose `error` is never checked:

- `processPriceAlerts`'s `price_alerts` update (marks `last_triggered_at` and, for
  `ONCE` mode, `enabled = false`) — currently happens, unchecked, and the code
  proceeds to send the push notification regardless of whether that write actually
  succeeded. If it silently failed, the alert's state never changed, so the **next**
  tick sees the identical crossing as still valid and fires again — a real duplicate
  notification, not a hypothetical one.
- `processGraphReminders`'s `graph_reminders.next_trigger_at` update — same shape of
  bug: if it fails, the reminder stays "due" (`next_trigger_at <= now`) and fires
  again next tick.
- `logNotification`'s `notification_log` insert — unchecked; a failure here isn't a
  duplicate-notification risk, but it silently loses the audit trail with no log line
  at all, contrary to section 36's logging intent.
- `pushToUserDevices`'s device-disable update (on a dead 404/410 subscription) —
  unchecked; lower severity (self-heals — a dead device just gets retried and fails
  again next time), but should still be logged on failure for consistency.
- `instruments.last_price`/`last_price_at` update — unchecked; lower severity (a
  stale baseline just delays detection by one tick, self-corrects), but log on failure.

### Decisions

- **Fix ordering, not just error-checking, for the two duplicate-risk cases**: in
  `processPriceAlerts` and `processGraphReminders`, the DB write that marks an
  event "handled" (price alert's trigger state / reminder's next occurrence) must
  happen and be **confirmed successful before** the push notification is sent. If
  the write fails: `console.error` with enough detail to find it in Supabase's
  function logs (alert/reminder id, the error), and `continue` to the next
  alert/reminder **without** sending a push or writing a `notification_log` row —
  the event stays in its "not yet handled" state and will be correctly retried next
  tick, matching the existing retry-by-construction pattern already used for a failed
  Binance fetch.
- **For the lower-severity unchecked writes** (`notification_log` insert, device
  disable, `instruments` price update): add `error` checks that `console.error` on
  failure. Do not add retry logic or new control flow for these — logging visibility
  is the actual gap, not a missing retry mechanism (avoid over-engineering per spec
  Rule 9 — this is a single-user app with light load, not a system that needs a full
  outbox/saga pattern for a handful of DB writes per 2-minute tick).
- **Do not change any evaluation logic** (`evaluatePriceAlert`, `computeNextTriggerAt`
  calls, crossing detection, window arithmetic) — this step is purely about confirming
  writes succeed before treating an event as handled, not about the business logic
  itself, which is already reviewed and correct.
- **Verify the fix actually works, not just that it reads correctly**: demonstrate
  (via a local `supabase start` stack, same pattern Step 2 used) a scenario where the
  triggering write genuinely fails (e.g. a constraint violation, or another concrete
  way to force a real failure — your call on the mechanism, but it must be a real
  failure, not a code-reading argument) and confirm no push/log happens and the event
  remains pending for the next tick. A passing "looks right" read-through is not
  suffient evidence for this specific fix, given the bug being fixed is exactly
  "the code looks right until a write silently fails."

### Build Order
1. Reorder + error-check `processPriceAlerts`'s trigger-marking update.
2. Reorder + error-check `processGraphReminders`'s `next_trigger_at` update.
3. Error-check + log the three lower-severity writes (`notification_log` insert,
   device-disable update, `instruments` price update).
4. Verify with a real forced-failure scenario per the Decisions above.

### Flags
- Flag: Keep the fix scoped to `supabase/functions/tick/index.ts` — no schema
  changes, no new packages, no changes to `evaluatePriceAlert`/`computeNextTriggerAt`.
- Flag: This file has no existing unit-test harness of its own (it's the Deno
  entrypoint, verified via local-stack scenarios in prior steps, not `vitest`) — don't
  invent a testing framework for it; match the verification style already established
  in handoff/BUILD-LOG.md's Step 2/Step 5 entries.

### Definition of Done
- [ ] `pnpm build`, `pnpm test`, `pnpm typecheck` pass (no changes expected to
      anything under `pnpm test`'s scope, but confirm nothing broke).
- [ ] `deno check supabase/functions/tick/index.ts` clean.
- [ ] A genuine forced-failure test demonstrates: (a) the triggering write's failure
      is logged, (b) no push/notification_log happens for that event on the failed
      tick, (c) the event is still evaluated (and can succeed) on a subsequent tick.
- [ ] All five identified unchecked writes have explicit error handling.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

**Scope**: `supabase/functions/tick/index.ts` only, per the Flags. No schema change, no
new package, no touch to `evaluatePriceAlert`/`computeNextTriggerAt`.

**1. `processPriceAlerts`** — after `evaluatePriceAlert` returns true: run the
`price_alerts` update (trigger-marking) first, destructure its `error`. If `error`:
`console.error("Price alert update failed, will retry next tick:", { alertId: alert.id, error })`
and `continue` — skip both `pushToUserDevices` and `logNotification` for this alert, do
not increment nothing else, loop proceeds to the next alert. If no error: proceed to the
existing push + log exactly as today. Net effect: identical happy-path behavior and
ordering of side effects visible to a user (push still sent only after the DB says the
alert is marked handled), the only change being the write is now confirmed before the
push instead of racing it.

**2. `processGraphReminders`** — same shape: compute `nextTriggerAt` (this call is
evaluation logic, not a write, so it can still happen before or after — moving the
write earlier doesn't require moving this), run the `graph_reminders.next_trigger_at`
update *before* `pushToUserDevices`/`logNotification`, check its `error`. If `error`:
`console.error` with `{ reminderId: reminder.id, error }`, `continue` to the next
reminder without push/log. If no error: push + log as today, using the now-already-
persisted `nextTriggerAt` (no behavior change to the notification content itself).

**3. Lower-severity writes** — add `const { error } = await ...` and
`if (error) console.error(...)` around: `logNotification`'s `notification_log` insert
(include `userId`/`eventType` in the log line), `pushToUserDevices`'s device-disable
update (include `deviceId`), and the `instruments.last_price` update (include
`instrumentId`). No control-flow change — these stay fire-and-forget, just observable
on failure now, per the brief's explicit anti-over-engineering instruction.

**4. Verification plan (real forced failure, not a read-through)**: use the same
`npx supabase start` local Docker stack pattern as Step 2/Step 5.
- Seed: one auth user, the XAUUSD instrument with a known `last_price`, one
  `price_alerts` row whose crossing condition the seeded price will satisfy, one
  `graph_reminders` row already due (`next_trigger_at` in the past), no devices (so
  `pushToUserDevices` naturally attempts 0 sends — isolates the write-ordering logic
  from push-delivery mechanics, which Step 2 already proved separately).
- **Forcing mechanism**: `revoke update on public.price_alerts from service_role;`
  (plain SQL against the local stack, run via `psql`/the Studio SQL editor) — a real
  Postgres permission-denied error on the exact `UPDATE` statement `processPriceAlerts`
  issues, returned by `supabase-js` as `{ error }` exactly like any other write failure
  (constraint violation, connection blip, etc. — the code being fixed doesn't
  discriminate on error *cause*, so a permission error exercises the identical code
  path a constraint violation would, without needing to fabricate a row shape that
  coincidentally violates a check constraint). Invoke the function once (`deno run` or
  `curl` against `functions serve`, whichever behaves like Step 2's finding). Assert:
  (a) `console.error`/response summary shows the alert's update failed, (b) zero rows
  in `notification_log`, (c) `price_alerts.enabled`/`last_triggered_at` unchanged. Then
  `grant update on public.price_alerts to service_role;` and invoke again: assert the
  alert now triggers normally (update succeeds, notification_log gets a row) — proving
  (c) from the brief's DoD, "still evaluated and can succeed on a subsequent tick."
- Repeat the identical revoke/grant/invoke-twice pattern against
  `public.graph_reminders` for the reminder path.
- Spot-check one lower-severity path the same way (e.g. `revoke insert on
  public.notification_log from service_role` for one tick) to confirm it logs and
  does not crash the function, then restore.
- Teardown: `grant` everything back (harmless on the throwaway local stack regardless,
  but done for hygiene) and `npx supabase stop`.

**Uncertain/flagged for Arch**: none — the brief's Decisions are specific enough that
this is mechanical; the only judgment call is the forcing mechanism (privilege
revocation) for the local-stack proof, called out here since the brief left the
"your call" open.

Per this session's instructions: proceeding directly (background run) rather than
waiting for a synchronous approval round-trip, matching the Step 5 precedent. Flagged
here for Arch to review alongside the resulting REVIEW-REQUEST.md.

Architect approval: [ ] Approved / [ ] Redirect — see notes below
