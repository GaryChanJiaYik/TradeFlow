# Review Request — Step 6: Reliability hardening — unchecked DB writes risk duplicate notifications
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## Context

Found during a deliberate hardening audit (spec Phase 17), not owner-reported. Full
detail: `handoff/ARCHITECT-BRIEF.md`'s Step 6.

`supabase-js` returns `{ data, error }` instead of throwing on a failed write.
`supabase/functions/tick/index.ts` — live in production, invoked every 2 minutes by
pg_cron — had five such writes with unchecked `error`. Two of them (`price_alerts`'
trigger-marking update, `graph_reminders`' `next_trigger_at` update) create a real
duplicate-notification risk: if the write silently fails but the push already went
out, the event's "handled" state never actually changes, so the next tick sees the
identical condition as still valid and fires again.

Builder Plan (written before building, per BUILDER.md, background run):
`handoff/ARCHITECT-BRIEF.md`'s Builder Plan section. Full verification detail:
`handoff/BUILD-LOG.md`'s new Step 6 entry.

## What Was Changed

**`supabase/functions/tick/index.ts`** — the only file touched (no schema change, no
new package, no change to `evaluatePriceAlert`/`computeNextTriggerAt`):

- **Lines ~220-235 (`processPriceAlerts`)**: the `price_alerts` trigger-marking update
  now runs and its `error` is checked *before* any push/log. On failure:
  `console.error` with the alert id and error, `continue` (skips push + log for that
  alert, leaving it retriable next tick). Why: this is the exact bug — a silently
  failed write followed by a push anyway.
- **Lines ~286-304 (`processGraphReminders`)**: reordered so the
  `graph_reminders.next_trigger_at` update happens and is error-checked *before* the
  push/log (previously it ran *after*). Same failure handling: log + `continue`.
  Why: same shape of duplicate-risk bug as above.
- **Lines ~168-183 (`logNotification`)**: `notification_log` insert now checks
  `error` and `console.error`s on failure. No control-flow change — this write stays
  fire-and-forget (a failure here loses an audit-trail row, not a duplicate-push
  risk).
- **Lines ~128-134 (`pushToUserDevices`)**: the device-disable update (on a dead
  404/410 push subscription) now checks `error` and logs on failure. No control-flow
  change (self-heals — a dead device just gets retried and fails again next time).
- **Lines ~356-362 (main handler)**: the `instruments.last_price`/`last_price_at`
  update now checks `error` and logs on failure. No control-flow change (a stale
  baseline just delays detection by one tick, self-corrects next tick).

All five unchecked writes identified in the brief now have explicit error handling.

## Why (one sentence per change)

- Reordered + error-checked the two duplicate-risk writes so a failed "mark handled"
  write can never be followed by a push that then can't be un-sent — matching the
  spec's idempotency requirement (section 35) and the existing retry-by-construction
  pattern already used for a failed Binance fetch.
- Added error checks (log-only, no retry) to the three lower-severity writes purely
  for observability (spec section 36) — over-engineering a retry mechanism for a
  single-user, light-load app was explicitly out of scope per the brief.

## Verification (genuine forced failure, not a read-through)

Per the brief's explicit instruction that a "looks right" read-through is
insufficient evidence for this specific fix. Used a throwaway local `supabase start`
Docker stack (same pattern as Steps 2/5), ran the real `tick/index.ts` entrypoint via
`deno run` against it (not `supabase functions serve` — same Windows/Docker
file-mounting limitation Step 2 already documented).

**Mechanism**: `revoke update on public.price_alerts/graph_reminders from
service_role` — a real Postgres `42501` permission-denied error on the exact
`UPDATE` statement the function issues, indistinguishable in shape from any other
real write failure (the fix branches on "did `error` come back non-null," not on
cause).

**Sequence and results**:
1. Seeded a user, an XAUUSD instrument baseline, a `CROSS_UP`/`ONCE` price alert, and
   an already-due graph reminder. Revoked `UPDATE` on both tables. Invoked the
   function twice: both failures logged via `console.error` with full Postgres error
   detail; DB confirmed afterward — `price_alerts.enabled` still `true`,
   `last_triggered_at` still `null`, `graph_reminders.next_trigger_at` unchanged,
   `notification_log` had **0 rows**. Proves (a) failure logged, (b) no push/log on
   the failed ticks, event stayed pending.
2. Granted `UPDATE` back, reset the instrument baseline, invoked again: DB confirmed
   `price_alerts.enabled` flipped to `false` with `last_triggered_at` set,
   `graph_reminders.next_trigger_at` advanced correctly, `notification_log` had
   **exactly one row per event** — no duplicates despite the two earlier failed
   attempts. Proves (c): the event was still evaluated and succeeded cleanly on a
   subsequent tick.
3. Spot-checked one lower-severity write (`notification_log` insert): revoked
   `INSERT` on that table, invoked once more with a fresh `EVERY_TIME` alert —
   function returned its normal 200 response (no crash), failure logged via
   `console.error`, and the alert's own state update **still succeeded** despite the
   log-insert failure, confirming this write is correctly non-blocking. Did not
   separately force-fail the device-disable and `instruments` writes — identical
   code pattern to the one just proven, and the brief's forced-failure requirement is
   specifically scoped to the two duplicate-risk cases.

Also confirmed: `deno check` on the file — clean. `pnpm build`/`pnpm test`/
`pnpm typecheck` at repo root — all green, no regressions (32 alert-engine, 37
validation, 12 market-data tests; 8/8 packages typecheck; `web` build green). Local
stack torn down (`npx supabase stop`); `git status` confirms only the two intended
files changed.

## Open Questions / Uncertainties

None outstanding. The brief's Decisions were specific enough that this step was
mechanical; the only judgment call — the forcing mechanism (privilege revocation) for
the local-stack proof — is documented in the Builder Plan and `BUILD-LOG.md` for
awareness, not as something requiring a decision.

**Not yet deployed**: this step's `tick/index.ts` changes are local-only, pending
review — `supabase functions deploy` needed after review clears, same gating as
every prior step.
