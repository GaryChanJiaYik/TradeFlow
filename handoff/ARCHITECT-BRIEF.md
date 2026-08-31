# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 2 (revision) — Swap active price feed from OANDA to Binance PAXG

Step 2 was built, reviewed, and committed against OANDA, but never deployed to production
(no real OANDA credentials were ever used — everything was tested against mocks/a local
stack). The owner's OANDA practice account signup is now confirmed unworkable (repeated
login failures), and two alternative broker demo APIs (Capital.com — not available in
Malaysia; Deriv — signup erroring) were also tried and failed for reasons outside our
control. After checking 12 data providers total, the owner has decided: use **Binance's
public PAXG/USDT ticker** as V1's XAUUSD price source, no offset/calibration against OANDA
(discussed and explicitly rejected — a static offset would drift since the PAXG-vs-spot
basis isn't constant, and there's no free live OANDA reference to calibrate against
anyway). This is a real, informed tradeoff: PAXG is a gold-backed crypto token, not
literally spot gold, and has historically run ~0.1-0.3% off an OANDA-sourced reference in
spot-checks — accepted as fine for a personal "check the chart" alert app.

This is a pre-deployment correction to Step 2, not a new step — do not renumber.

### Decisions

- **New `BinanceProvider`** (`packages/market-data/src/binanceProvider.ts`): implements
  `MarketDataProvider` via `GET https://data-api.binance.vision/api/v3/ticker/price?symbol=PAXGUSDT`
  — Binance's public, **keyless, no-signup** market-data mirror (confirmed working via a
  real test call: `{"symbol":"PAXGUSDT","price":"4433.33000000"}`). No API key, no secret,
  no env vars needed for this provider at all. Map our internal symbol `XAUUSD` to
  Binance's `PAXGUSDT` pair internally (same one-mapping-per-symbol pattern
  `OANDAProvider` already used for `XAUUSD` → `XAU_USD`). Parse the `price` field as the
  `PriceUpdate.price` (a string in Binance's response — parse to number, never silently
  return `NaN`; throw a typed error, mirroring `OANDAProviderError`'s pattern, on a
  non-200 response or a missing/non-numeric `price` field). Unit test with mocked
  `fetch`: successful parse, HTTP error status, malformed/missing `price` field.
- **`OANDAProvider` stays in the codebase, unused for now** — it's fully built, tested,
  and reviewed; do not delete it. It's the concrete example of exactly the kind of
  future-provider swap `packages/market-data`'s abstraction exists for (per
  PROJECT_SPEC.txt sections 7/24/25 — `MarketDataProvider` should support multiple
  providers without a rewrite). Do not wire it into anything active; do not leave any
  code path that silently tries to call it.
- **`supabase/functions/tick/index.ts`**: change `buildOandaProvider()` (and its call
  site) to build and use `BinanceProvider` instead. Remove the `OANDA_API_TOKEN` /
  `OANDA_ACCOUNT_ID` / `OANDA_ENV` env var requirements from this function entirely
  (no longer needed on the active path) — but don't touch anything else in this file's
  logic (alert evaluation, push sending, reminder handling all stay exactly as reviewed).
- **Docs**: Update `README.md`'s COST/FREE TIER section — replace/annotate the OANDA
  entry to reflect it's a documented future option (not currently wired in), and add a
  Binance entry (purpose, free-tier limit — Binance's public data endpoints are
  rate-limited per IP but generously so for one instrument polled every 2 minutes,
  no cost, no signup, what would change if that ever stopped being true, alternative:
  swap back to OANDA/another provider via the existing abstraction). Update
  `docs/SETUP.md` to remove the now-unnecessary OANDA env var setup steps from the
  "getting a working local dev environment" path (keep a short note that
  `OANDAProvider` exists and how someone would wire it back in later, without making it
  sound like a required setup step).
- **`.env.local.example` files**: remove the OANDA placeholder entries from
  `apps/web/.env.local.example` and `supabase/functions/.env.local.example` (nothing in
  the active path reads them anymore) — do not delete anything Web-Push-related.

### Build Order
1. `packages/market-data/src/binanceProvider.ts` + unit tests (mocked `fetch`).
2. Update `supabase/functions/tick/index.ts` to use `BinanceProvider`; remove the now-dead
   OANDA env var reads from this file specifically.
3. Update `.env.local.example` files (both) to drop the OANDA placeholders.
4. Update `README.md` and `docs/SETUP.md` per the Decisions above.
5. Re-run `pnpm build`/`test`/`typecheck` at repo root — confirm nothing else references
   the now-removed OANDA env vars in the active path (grep for `OANDA_API_TOKEN`/
   `OANDA_ACCOUNT_ID` outside of `oandaProvider.ts` and its own test file to be sure).

### Flags
- Flag: Do not delete `oandaProvider.ts` or its tests — it's a deliberate, working,
  reviewed alternate implementation kept for a future provider swap, not dead code.
- Flag: Binance's public `data-api.binance.vision` endpoint needs no auth/secrets — if
  you find yourself wanting to add any Binance API key/secret handling, stop, that's
  not needed for public market-data endpoints and would be scope creep.
- Flag: Don't touch anything else in `tick/index.ts` beyond the provider swap — alert
  evaluation, push sending, and reminder logic were already reviewed clear and are out
  of scope for this revision.

### Definition of Done
- [ ] `pnpm build`, `pnpm test`, `pnpm typecheck` pass at repo root, including new
      `BinanceProvider` tests.
- [ ] `supabase/functions/tick/index.ts` uses `BinanceProvider`; no reference to
      `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID`/`OANDA_ENV` remains in its active code path.
- [ ] `README.md` and `docs/SETUP.md` reflect Binance as the active source, OANDA as a
      documented future option.
- [ ] `.env.local.example` files no longer list OANDA placeholders.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

[Builder writes plan here]

Architect approval: [ ] Approved / [ ] Redirect — see notes below
