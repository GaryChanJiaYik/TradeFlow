# Review Request — Step 7: ChartGoldPriceProvider as primary XAUUSD source, Binance as automatic fallback
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

**Update (2026-09-11): both Should Fix items from Richard's first review addressed —
see "Should Fix items addressed" section below. Re-submitted.**

---

## Context

Owner researched alternative free gold-price APIs (two dead/blocked, one a
`gold-api.com` reseller, one capped at 1,000 calls/month against our ~21,600/month
2-minute-poll volume). The remaining candidate, `chartgoldprice.com`, checked out:
live, no documented rate limit, CORS-enabled, free with attribution only — but no
named operator and no SLA. Full detail: `handoff/ARCHITECT-BRIEF.md`'s Step 7.

Builder Plan (written before building, per BUILDER.md, background run):
`handoff/ARCHITECT-BRIEF.md`'s Builder Plan section. Full verification detail:
`handoff/BUILD-LOG.md`'s new Step 7 entry.

## What Was Changed

**New files:**
- `packages/market-data/src/chartGoldPriceProvider.ts` (full file, ~130 lines) — new
  `ChartGoldPriceProvider` + `ChartGoldPriceProviderError`. Parses
  `GET https://www.chartgoldprice.com/api/data`'s `prices.gold.troy_ounce` as price;
  throws `STALE_DATA` if `meta.updated_at` is missing, unparsable, or more than 15
  minutes old at call time (injectable `now`). Mirrors `binanceProvider.ts`'s exact
  shape/style.
- `packages/market-data/src/fallbackProvider.ts` (full file, ~65 lines) — new
  `FallbackMarketDataProvider` + `FallbackProviderError`. Tries an ordered
  `MarketDataProvider[]` in sequence, logs (`console.error`) and falls through on any
  failure, returns the first success untouched, throws an aggregate error (carrying
  every individual error in `.errors`) only if all fail.
- `packages/market-data/src/__tests__/chartGoldPriceProvider.test.ts` (8 tests) and
  `fallbackProvider.test.ts` (3 tests) — mocked-`fetch`, matching the existing
  provider tests' style.

**Changed files:**
- `packages/market-data/src/index.ts` (lines 4-5) — exports the two new modules.
- `supabase/functions/tick/index.ts`:
  - Lines 1-9, 16-18: top-of-file comments updated to describe the new
    primary/fallback price source instead of only Binance.
  - Lines 28-39: new imports for `ChartGoldPriceProvider`/`ChartGoldPriceProviderError`
    and `FallbackMarketDataProvider`/`FallbackProviderError`.
  - Lines ~68-79 (new `describeProviderError` helper) and ~82-90 (`buildFallbackProvider`,
    replacing `buildBinanceProvider`): the tick function now builds
    `new FallbackMarketDataProvider([new ChartGoldPriceProvider(), new BinanceProvider()])`
    instead of a bare `BinanceProvider`. `BinanceProvider` itself is unchanged.
  - The main handler's catch block (~line 370s) now uses `describeProviderError` and
    a `FallbackProviderError` branch instead of a single `instanceof BinanceProviderError`
    check, so a total failure's logged reason still shows every provider's individual
    error instead of collapsing to one opaque message.
- `README.md`'s COST/FREE TIER section — new `chartgoldprice.com` entry added before
  the existing Binance entry; Binance's entry updated to describe its new role as
  automatic fallback (was: sole source).

## Why (one sentence per change)

- Added `ChartGoldPriceProvider` because the owner found a free, keyless, real-spot-gold
  source with no documented rate limit, worth using as primary despite its lack of an
  SLA.
- Added the 15-minute staleness check inside the provider itself (not left to the
  caller) so a caller can never receive/act on an old price without knowing it,
  matching the brief's explicit instruction not to trust an old value silently.
- Added `FallbackMarketDataProvider` as a separate, reusable wrapper (rather than
  inlining try/catch logic into `tick/index.ts`) so the fallback behavior is itself
  unit-testable independent of Deno/Supabase, and so any future third provider could be
  added to the same ordered list with zero changes to the Edge Function.
- Kept `BinanceProvider` completely untouched, per the brief's explicit flag — it
  remains the tested, already-proven-in-production safety net.
- Generalized the tick function's error-formatting instead of leaving the old
  `BinanceProviderError`-only check in place, because after this change a real failure
  path (`FallbackProviderError`) would otherwise have logged an unhelpful generic
  string instead of the underlying providers' actual error details.

## Verification

- `pnpm --filter @tradeflow/market-data test`: 23/23 pass (12 pre-existing + 11 new).
- `pnpm build` / `pnpm test` / `pnpm typecheck` at repo root: all green. 92 tests total
  across the workspace, no regressions, `web`'s Next.js build still compiles.
- `deno check supabase/functions/tick/index.ts`: clean.
- Live smoke test: this environment (unlike Arch's) resolved `www.chartgoldprice.com`
  fine. A real `curl` call confirmed the response shape matches the brief's documented
  fields exactly (`meta.updated_at`, `prices.gold.troy_ounce`) — nothing guessed.

## Should Fix items addressed (Richard's 2026-09-11 review)

Both were fixed inline in `packages/market-data/src/chartGoldPriceProvider.ts` (under 5
minutes each, per BUILDER.md); no other file needed changes:

1. **Untyped errors from raw `fetch`/`response.json()` (line 88, 97).** Both calls are
   now individually wrapped in `try/catch`. A network-level throw (e.g. DNS failure) or
   a non-JSON response body now throws a typed `ChartGoldPriceProviderError` with a new
   `NETWORK_ERROR` code (added to the `ChartGoldPriceProviderErrorCode` union) instead of
   an untyped error escaping. Fallback behavior is unchanged — `FallbackMarketDataProvider`
   already caught both typed and untyped errors identically. `tick/index.ts`'s
   `describeProviderError` needed no change: it already branches on
   `instanceof ChartGoldPriceProviderError` and reads `.code`/`.message` generically
   rather than switching on specific code values, so it picks up `NETWORK_ERROR`
   automatically.
2. **`new Date()` instead of the injectable `now()` for the returned timestamp (line
   130).** Now uses `this.now().toISOString()`, matching the staleness check's use of
   the same injected clock. No production behavior change; makes the injection point
   fully deterministic for tests.

**Tests added** (`chartGoldPriceProvider.test.ts`, 10 tests now, was 8): one for
`fetchFn` rejecting, one for a non-JSON response body, both asserting the new
`NETWORK_ERROR` code. Also strengthened the existing successful-parse test to assert
`result.timestamp` equals the injected `now` exactly, rather than just "parses without
throwing" — closes the exact gap Richard's note identified.

**Verification re-run after the fix:**
- `pnpm --filter @tradeflow/market-data test`: 25/25 pass (up from 23).
- `pnpm build` / `pnpm test` / `pnpm typecheck` at repo root: all green, no
  regressions. 94 tests total across the workspace (37 validation, 32 alert-engine, 25
  market-data); 8/8 packages typecheck; `web`'s Next.js build still compiles.
- `deno check supabase/functions/tick/index.ts`: clean.

## Open Questions / Uncertainties

- **Real finding, not a bug**: at live-smoke-test time (2026-09-11T00:46 UTC),
  chartgoldprice.com's own `meta.updated_at` was already ~14 hours old — past this
  step's 15-minute staleness threshold. Deployed today, `ChartGoldPriceProvider` would
  currently throw `STALE_DATA` on every tick and the fallback would serve every price
  from Binance until chartgoldprice.com's feed itself updates. This is exactly the
  risk the brief anticipated (no SLA, no named operator) and exactly why the fallback
  exists — flagging it so Arch/owner know to check post-deploy which provider is
  actually serving ticks, rather than assuming chartgoldprice.com will be primary in
  practice as often as its "no rate limit" characteristic might suggest. Logged as
  KG-15 in `handoff/BUILD-LOG.md`.
- No deviation from the brief's Decisions, Build Order, or Flags. The three
  Builder-level judgment calls (aggregate error shape, `provider.constructor.name` for
  fallback log labels, `"CHARTGOLDPRICE"` as the `PriceUpdate.provider` string) were
  flagged in the Builder Plan before building; none change behavior in a way that
  would need a different answer to build correctly, just naming/shape choices where
  the brief didn't specify.

**Not yet deployed**: this step's changes are local-only, pending review —
`supabase functions deploy` needed after review clears, same gating as every prior
step. Steps 1-6 remain live and unaffected.
