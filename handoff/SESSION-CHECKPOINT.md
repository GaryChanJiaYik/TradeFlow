# Session Checkpoint — 2026-08-31

---

## Where We Stopped

Steps 1 and 2 (plus the Step 2 revision swapping the price feed to Binance) are all
built, reviewed, and clear. Committed through `c227b97`. The XAUUSD price source is
now Binance's public, keyless PAXG/USDT ticker — no signup, no secrets, unblocks
everything that was stuck on OANDA account access. `OANDAProvider` stays in the
codebase, unused, as a documented future upgrade path.

Nothing is deployed to production yet. What's blocking that, all owner/Arch-side:
- `pg_cron`/`pg_net` extensions not yet enabled on the live Supabase project.
- `supabase functions deploy` not yet run against the live project.
- No confirmed Cloudflare account for the actual `wrangler deploy`.
- VAPID_SUBJECT contact email — asked owner, no answer yet.
- A few harmless `push-verify-*@example.com` test users are sitting in the
  live Supabase project from live verification — owner can delete via the
  dashboard whenever, not urgent.

The OANDA/broker-credential blocker is gone — no external account is needed for the
price feed anymore. Next action: enable pg_cron/pg_net, deploy the function, deploy
the web app (needs a hosting decision confirmed — Cloudflare or otherwise), then run
the actual Milestone 1 proof (create a real alert, close the browser, laptop off,
wait for a real PAXG/USDT crossing, confirm the phone gets the push). No further
Bob/Richard cycles should be needed for that — it's owner+Arch executing what's
already built.

---

## What Was Decided This Session

- After checking 12 data providers (OANDA, Twelve Data, Finnhub, Alpha Vantage,
  Massive/Polygon, Alpaca, Public.com, EODHD, QuantHouse, Webull, Capital.com,
  UniRateAPI) and 3 broker demo signups (OANDA, Capital.com, Deriv) all failing for
  various reasons (paid-gated data, no forex/commodity support, or account-creation
  friction/errors/geo-restriction), settled on **Binance's public PAXG/USDT ticker**
  as V1's XAUUSD source. Pattern found: every retail-friendly "developer API" gates
  real-time gold/commodity data behind a paid plan; free real-time access only
  exists via a broker's own demo account or a crypto-market proxy.
- Explicitly rejected applying a static offset to align Binance's price with OANDA's:
  the PAXG-vs-spot basis isn't constant and there's no free live OANDA reference to
  calibrate against, so a fixed offset would drift and could make things worse, not
  better. Accepted the ~0.1-0.3% gap as-is.
- `OANDAProvider` kept in the codebase (built, tested, reviewed) as a deliberate,
  documented, currently-unwired future upgrade path — not deleted.

---

## Still Open

- Owner/Arch: enable `pg_cron`/`pg_net` extensions on the live Supabase project
  dashboard.
- Owner: confirm a Cloudflare account, or say if a different free host is
  preferred instead.
- Owner: VAPID_SUBJECT contact email.
- Arch: once the above land, run `supabase functions deploy`, deploy the web
  app, then the real Milestone 1 laptop-off proof.
- (Not urgent) Owner: delete leftover `push-verify-*@example.com` test users from
  the live Supabase project dashboard.
- (Not urgent, future) If/when OANDA or another broker demo account becomes
  workable, swap `BinanceProvider` back to `OANDAProvider` (or a new provider) in
  `supabase/functions/tick/index.ts` — the abstraction makes this a small, isolated
  change.

---

## Resume Prompt

Copy and paste this to resume:

---

You are Arch on TradeFlow.
Read SESSION-CHECKPOINT.md, then ARCHITECT.md.
Confirm where we stopped and what the next action is. Then wait.

---

## Version Check
version_notified:
