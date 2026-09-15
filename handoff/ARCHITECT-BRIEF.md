# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 11 — MT4/TMGM live-tick bridge + order-fill alerts

Owner trades XAUUSD on MT4 with broker TMGM and found TradeFlow's price (Binance
PAXG/USDT, calibrated against chartgoldprice.com) doesn't match what they actually
trade at. Explored and rejected this session: GoldAPI.io (tried, then reverted —
owner judged it unreliable), Forex.com's API (needs an actual funded/demo account
plus multi-day manual approval — the same wall already hit with OANDA/Capital.com/
Deriv in the Step 2 revision), TMGM's own free-VPS perk (needs 7 lots/month or a
$3,000 deposit, which the owner doesn't meet).

Landed on: a custom MQL4 EA on Oracle Cloud's free-forever `VM.Standard.E2.1.Micro`
(x86_64, 1GB RAM — the only OCI/GCP free-tier shape that's both genuinely free and
the right CPU architecture for Wine; OCI's bigger ARM Ampere free tier needs an
unreliable extra emulation layer for Wine) pushes MT4's real, live tick to a new
TradeFlow webhook. That becomes the **primary** source for `instruments.last_price`,
with Binance polling in `tick-fast` staying as an automatic fallback — 1GB RAM is
genuinely below the ~2GB community-recommended minimum for stable Wine+MT4, and this
project has already been burned once this week by trusting an external source's
uptime unconditionally (chartgoldprice.com). The EA also detects order fills (MT4 has
no `OnTradeTransaction()`, unlike MT5 — must poll and diff `OrdersTotal()`) and pushes
an immediate notification.

This is the first *inbound* webhook TradeFlow will have — every existing Edge
Function is either pg_cron-triggered (service-role-key bearer token, itself a valid
project JWT) or a logged-in browser session under RLS. The MT4 EA has neither.

Full reasoning is in the approved plan:
`C:\Users\jychan\.claude\plans\this-is-my-project-nifty-mist.md`.

### Decisions

- **One webhook endpoint, not two**, discriminated by `"type": "PRICE_TICK" |
  "ORDER_FILLED"`. MT4's `WebRequest()` allow-list (Tools > Options > Expert
  Advisors) is GUI-only with no scriptable path — every distinct URL is a manual
  click-through step, so one URL beats two. New file:
  `supabase/functions/mt4-webhook/index.ts`.
- **`verify_jwt = false` required, easy to miss.** The EA has no project-signed JWT.
  Added to `supabase/config.toml` (`[functions.mt4-webhook]` — the first
  `[functions.*]` section this repo has needed). With it off, the shared secret is
  the *only* auth layer for this function, not a second one.
- **Auth**: `MT4_WEBHOOK_SECRET` Edge Function secret, checked via `x-webhook-secret`
  header, plain `===` compare (no timing-attack defense needed for a personal app).
  The function's own service-role client does the DB writes — the EA/VPS never holds
  that key.
- **Target user**: `MT4_WEBHOOK_USER_ID` env var (no logged-in session on an inbound
  webhook to derive this from). A query-time "the one user" lookup was considered and
  rejected — silently wrong forever if a second `auth.users` row ever appears, vs. a
  fixed ID that fails loudly if unset and can never resolve to the wrong user.
- **MT4-primary / Binance-fallback gate, in `tick-fast`**: a freshness check
  (`isMt4Fresh`), not a try/catch — MT4 is a *push* source, `FallbackMarketDataProvider`'s
  shape doesn't apply. New `instruments.mt4_last_seen_at` (written only by
  `mt4-webhook`, using that function's own server clock, never the EA's self-reported
  time) + `MT4_FRESHNESS_SECONDS` (default 25s: tick-fast runs every 10s, the EA
  heartbeats every 5s, so 25s covers two consecutive missed heartbeats).
- **Exactly one active evaluator at a time, not just one active writer.** When MT4 is
  fresh, `tick-fast` skips its Binance fetch, alert evaluation, AND the `last_price`
  write entirely — not just the write — so the same crossing is never evaluated twice
  against two different price streams in the same window.
- **No `applyPriceBasis()` on the MT4 path** — that correction compensates for
  Binance's PAXG-vs-spot drift; MT4/TMGM's price is already the real broker price it
  approximates.
- **`processPriceAlerts` extracted** out of `tick-fast/index.ts` into
  `supabase/functions/_shared/processPriceAlerts.ts` (moved verbatim, no logic
  change) so both `tick-fast` and `mt4-webhook` share one evaluator. Lives beside
  `_shared/notifications.ts`, not in `packages/alert-engine` — that package is
  deliberately pure/I-O-free; this function is all I/O.
- **No fill-ledger table, no server-side ticket-dedup** — the EA's own in-memory
  ticket/type snapshot (rebuilt fully every poll, not incrementally patched — avoids
  a known `OrdersTotal()`-unchanged-between-two-real-changes blind spot) is enough for
  a personal account's order volume.
- **Fill detection must catch orders not placed by this EA** (owner trades
  manually/elsewhere) — polls and diffs `OrdersTotal()`/`OrderSelect(...,
  MODE_TRADES)` every tick/timer regardless of origin. Exact transition tracked:
  ticket → last-seen `OrderType()`, since a pending order triggering keeps its ticket
  number (only the type changes) — a bare "is this ticket new" check would miss that
  case.

### Schema — `supabase/migrations/0007_mt4_webhook.sql`

`instruments` gains `mt4_last_seen_at timestamptz` and `price_source text check
(price_source in ('MT4','BINANCE')) default 'BINANCE'`. `notification_log`'s
`event_type` check constraint gains `'ORDER_FILLED'`. Written here, applied manually
via the dashboard SQL Editor per the existing KG-8 constraint (no `supabase db push`
from this network). Documented rollback included, same convention as every prior
migration.

### Build Order
1. Extract `processPriceAlerts` to `_shared/processPriceAlerts.ts` (mechanical move).
2. `0007_mt4_webhook.sql` + `packages/types` updates (`enums.ts`'s
   `NotificationEventType`/new `PriceSource`, `instrument.ts`'s two new fields) +
   `_shared/notifications.ts`'s `logNotification` type widening.
3. `supabase/functions/mt4-webhook/index.ts` — build, then verify locally against a
   throwaway `supabase start` stack: a `PRICE_TICK` payload updates
   `last_price`/`mt4_last_seen_at`/`price_source` and fires a crafted crossing; an
   `ORDER_FILLED` payload logs a push + `notification_log` row; bad-secret (401) and
   malformed-body (400) paths both verified.
4. `tick-fast/index.ts`'s `isMt4Fresh` gate — verify locally: a fresh
   `mt4_last_seen_at` skips Binance entirely; a stale one (26s+) falls through
   exactly as before.
5. `supabase/config.toml`'s `[functions.mt4-webhook]` section — do not deploy without
   it, or every request will be rejected before this function's own code runs.
6. `mt4/TradeFlowMt4Bridge.mq4` + `mt4/README.md` (VPS runbook) — **not compiled or
   tested against a real MetaEditor/MT4 terminal**, since none is available in this
   environment. Flag this clearly; the owner must verify compilation and real-world
   behavior on the actual VPS per the runbook's verification checklist.
7. `handoff/BUILD-LOG.md` entry per this project's established process.

### Flags
- Flag: `TradeFlowMt4Bridge.mq4` is unverified MQL4 — written carefully from
  real MQL5/MQL4 community documentation (WebRequest signature, fill-detection
  pattern, MetaEditor CLI quirks), but never compiled. Treat as a first draft the
  owner must actually compile and soak-test, not proven-correct code.
- Flag: the free VPS's 1GB RAM is a known, accepted risk (that's the entire reason
  the Binance fallback exists) — do not treat an unstable EA connection as a bug to
  fix by adding complexity; the fallback is the fix.
- Flag: do not let `processPriceAlerts`'s move drift from its Step 6
  confirm-write-before-push ordering — regression-sensitive, already-proven-in-
  production logic.

### Definition of Done
- [ ] `deno check` clean on `mt4-webhook/index.ts` and `tick-fast/index.ts`.
- [ ] `pnpm build`/`test`/`typecheck` pass (no-op regression check for existing
      packages).
- [ ] Local verification of all `mt4-webhook`/`tick-fast` behavior in Build Order
      steps 3-4 actually performed and documented, not just "code looks right."
- [ ] Migration file written and locally verified, not yet applied to the live
      project (Arch does that after review).
- [ ] MQL4 EA and VPS runbook written, explicitly flagged as unverified pending real
      compilation/hardware — not claimed as tested when it isn't.

---

## Builder Plan
*Approved 2026-09-15 via plan mode — see
`C:\Users\jychan\.claude\plans\this-is-my-project-nifty-mist.md` for the full plan
this brief summarizes. Implemented directly in this session; see
`handoff/BUILD-LOG.md`'s Step 11 entry for the verification story.*
