# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 7 — ChartGoldPriceProvider as primary XAUUSD source, Binance as automatic fallback

Owner researched alternative free gold-price APIs. Two of four candidates checked out
as dead/blocked, one (`xaus.com`) turned out to just resell `gold-api.com`, one
(`goldprice.dev`) is real but capped at 1,000 calls/month (far too low for our ~21,600/
month 2-minute-poll volume). The remaining candidate, `chartgoldprice.com`, checked
out: confirmed live (price genuinely updates), no documented rate limit (survived a
10-request burst with no throttling), CORS-enabled, free with attribution only (no
API key, no payment). It has no named operator and no SLA ("as is, as available," no
uptime guarantee in its terms) — real risk it could degrade or disappear without
notice, which is exactly why this step adds it as **primary with automatic fallback
to the already-proven Binance PAXG feed**, not a hard swap.

### Decisions

- **New `ChartGoldPriceProvider`** (`packages/market-data/src/chartGoldPriceProvider.ts`):
  implements `MarketDataProvider` via `GET https://www.chartgoldprice.com/api/data`
  (no auth, no key). Response shape:
  `{"meta":{"updated_at":"<ISO 8601>", ...},"prices":{"gold":{"symbol":"XAU","troy_ounce":<number>, ...}, ...}}`
  — parse `prices.gold.troy_ounce` as the price. **Staleness check**: also parse
  `meta.updated_at`; if it's more than 15 minutes older than "now" at call time, treat
  this as a provider failure (throw a typed error) rather than returning a stale price
  — this service says it refreshes "on a schedule" with no documented interval
  guarantee, so don't trust an old value silently. Mirror `BinanceProviderError`'s
  pattern exactly: a typed `ChartGoldPriceProviderError` with a `code` (e.g.
  `HTTP_ERROR`, `INVALID_PRICE`, `STALE_DATA`), never returns `NaN`, never silently
  swallows a bad response.
- **New `FallbackMarketDataProvider`** (`packages/market-data/src/fallbackProvider.ts`):
  implements `MarketDataProvider`, constructed with an ordered array of providers
  (`new FallbackMarketDataProvider([chartGoldPriceProvider, binanceProvider])`).
  `getPrice(instrument)` tries each provider in order; on any thrown error, logs which
  provider failed and why (`console.error` — this runs inside the `tick` function, so
  it surfaces in Supabase's function logs) and tries the next; returns the first
  success as-is (the winning provider's own `PriceUpdate.provider` field is preserved,
  so it's always clear from the data itself which source actually supplied a given
  tick). If every provider fails, throw an aggregate error containing all of their
  individual errors (don't swallow the earlier failures' detail).
- **Wire into `supabase/functions/tick/index.ts`**: replace the direct
  `buildBinanceProvider()` call with a `buildFallbackProvider()` that constructs
  `new FallbackMarketDataProvider([new ChartGoldPriceProvider(), new BinanceProvider()])`.
  `BinanceProvider` stays exactly as-is, unchanged, still no credentials needed.
- **Local network note, so you don't waste time chasing a false alarm**: this owner's
  local dev network fails to resolve `www.chartgoldprice.com` via its corporate DNS
  server (confirmed: the apex domain and `drhint.com` resolve fine, but this one
  subdomain specifically doesn't, via that one DNS server — a local quirk, not a dead
  site; confirmed working via Google DNS / `curl --resolve`). This should not affect
  Supabase's Edge Function runtime (different infrastructure, different DNS). You
  don't need live network access to `chartgoldprice.com` to build or test this
  provider correctly anyway — test with a mocked `fetch`, exactly like
  `binanceProvider.test.ts`/`oandaProvider.test.ts` already do. If you want to
  smoke-test against the real endpoint and hit the same local DNS gap, that's expected
  here, not a sign anything is broken — note it and move on, don't debug the DNS.
- **Docs**: add a `chartgoldprice.com` entry to `README.md`'s COST/FREE TIER section
  (purpose, free-tier characteristics — no documented limit but no SLA/named operator,
  what happens if it fails — automatic fallback to Binance, already covered above).

### Build Order
1. `ChartGoldPriceProvider` + unit tests (mocked `fetch`): successful parse, HTTP
   error, malformed/missing `troy_ounce`, stale `updated_at` (>15 min old).
2. `FallbackMarketDataProvider` + unit tests: primary succeeds (fallback never called —
   assert this, not just that the right value comes back); primary throws, fallback
   succeeds; both throw (assert the aggregate error contains both underlying errors).
3. Wire into `tick/index.ts`.
4. README update.
5. Verify: `pnpm build`/`test`/`typecheck`, `deno check`. If you have working network
   access to `chartgoldprice.com` in your environment, do one live smoke-test call
   confirming a real parse; if you hit the same local DNS gap Arch hit, that's fine,
   the mocked-fetch tests are the real verification here.

### Flags
- Flag: Keep `BinanceProvider` completely unchanged — it's the safety net, not being
  replaced.
- Flag: Do not guess `chartgoldprice.com`'s exact response field names — the shape
  above is confirmed from a real response Arch captured; if your own test call
  returns something different, treat that as a real finding to report, not something
  to silently work around.
- Flag: The staleness threshold (15 minutes) is Arch's judgment call, generous
  relative to our 2-minute poll interval — if you have a reason to pick a different
  number, say so rather than silently changing it.

### Definition of Done
- [ ] `pnpm build`, `pnpm test`, `pnpm typecheck` pass, including new provider and
      fallback-wrapper tests.
- [ ] `deno check supabase/functions/tick/index.ts` clean.
- [ ] Fallback behavior proven via tests: primary-success, primary-fail-secondary-
      succeeds, and both-fail paths all covered, not just the happy path.
- [ ] README documents the new provider per spec section 37's format.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

**Files to add:**
- `packages/market-data/src/chartGoldPriceProvider.ts` — `ChartGoldPriceProvider` +
  `ChartGoldPriceProviderError` (codes: `HTTP_ERROR`, `INVALID_PRICE`, `STALE_DATA`),
  mirroring `binanceProvider.ts`'s shape/style exactly (injectable `fetchFn`, typed
  error class, never returns `NaN`). Endpoint:
  `GET https://www.chartgoldprice.com/api/data`. Parses `prices.gold.troy_ounce` as
  price and `meta.updated_at` for the staleness check (>15 min old at call time ->
  `STALE_DATA`). `PriceUpdate.provider` will be `"CHARTGOLDPRICE"`.
- `packages/market-data/src/fallbackProvider.ts` — `FallbackMarketDataProvider` +
  `FallbackProviderError` (aggregate error, code `ALL_PROVIDERS_FAILED`, carries an
  `errors: unknown[]` array of every provider's individual thrown error in order).
  Constructed with an ordered `MarketDataProvider[]`; `getPrice` tries each in order,
  `console.error`-logs `<ProviderName failed: reason>` per failure (using the
  provider's own constructor name for the log label since `MarketDataProvider` has no
  name field), returns the first success untouched. Throws the aggregate only if every
  provider fails.
- `packages/market-data/src/__tests__/chartGoldPriceProvider.test.ts` and
  `fallbackProvider.test.ts`, mirroring `binanceProvider.test.ts`'s mocked-`fetch`
  style — cases per the brief's Build Order (successful parse, HTTP error, malformed/
  missing `troy_ounce`, stale `updated_at`; primary-success-fallback-not-called,
  primary-fail-fallback-succeeds, both-fail-aggregate-contains-both).
- Export both new modules from `packages/market-data/src/index.ts`.

**Files to change:**
- `supabase/functions/tick/index.ts` — replace `buildBinanceProvider()` (and its
  BinanceProvider-only import) with `buildFallbackProvider()` returning
  `new FallbackMarketDataProvider([new ChartGoldPriceProvider(), new BinanceProvider()])`.
  The existing catch block's error-message formatting
  (`err instanceof BinanceProviderError ? ... : String(err)`) will be generalized to
  also recognize `ChartGoldPriceProviderError` and `FallbackProviderError` (unwrapping
  the aggregate's inner errors into the logged reason) so a real failure still logs
  something actionable instead of an opaque `[object Object]`/`Error: ...` string.
  `BinanceProvider` itself: untouched.
- `README.md`'s COST/FREE TIER section — new `chartgoldprice.com` entry (same
  four-part format as the existing Binance/Supabase/Cloudflare entries: free tier
  characteristics, what happens if it fails, potential paid cost, alternative),
  and the Binance entry's "Alternative" line gets a one-clause update noting it's now
  the fallback rather than sole source.

**Decisions carried from the brief (not re-litigating):** ChartGoldPrice as primary,
Binance as fallback, unchanged; 15-minute staleness threshold, as specified; response
field names taken verbatim from the brief, not guessed.

**Builder-level decisions requiring judgment (flagging rather than silently deciding):**
1. **Aggregate error shape** — no existing convention in this codebase for a
   multi-error wrapper. Chose a typed `FallbackProviderError extends Error` with a
   single `code: "ALL_PROVIDERS_FAILED"` and an `errors: unknown[]` property (parallel
   array to the provider list, same order), message built by joining each error's
   `.message`. Picked over Node's native `AggregateError` because this codebase
   otherwise always uses its own `<Provider>Error` classes with a `code` field for
   `instanceof`-based handling at the call site (see the tick catch block), and Deno's
   `AggregateError` support/inspection formatting is less predictable than a plain
   custom class.
2. **Provider identification in fallback's log line** — `MarketDataProvider` is a bare
   interface (no `name`/`id` field). Using `provider.constructor.name` (e.g.
   `"ChartGoldPriceProvider"`, `"BinanceProvider"`) for the `console.error` label
   rather than adding a new required interface member, to avoid touching the
   `MarketDataProvider` contract (and thus `OANDAProvider`, unused but still
   implementing it) for this step.
3. **`PriceUpdate.provider` string for the new provider** — using `"CHARTGOLDPRICE"`
   (matches `"BINANCE"`/`"OANDA"`'s all-caps convention already in
   `packages/types/src/priceUpdate.ts`'s comment and both existing providers).
4. Per the brief's own note, will not chase the local DNS gap if hit; mocked-fetch
   tests are the verification bar. Will attempt one live smoke-test call and report
   the outcome either way.

No deviations from the brief's Decisions/Build Order/Flags otherwise. Proceeding to
build now (background run, per instruction) — will report any real surprises (e.g. a
live response shape mismatch) rather than silently working around them.

Architect approval: [ ] Approved / [ ] Redirect — see notes below
