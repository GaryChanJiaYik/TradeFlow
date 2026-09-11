# Review Feedback — Step 7
Date: 2026-09-11
Ready for Builder: YES

## Must Fix
None.

## Should Fix
[Does not block. Fix inline if under 5 minutes, otherwise log to BUILD-LOG.]

- `packages/market-data/src/chartGoldPriceProvider.ts:88,97` — `this.fetchFn(url)` and
  `response.json()` are not wrapped in try/catch, so a network-level throw or a
  non-JSON body would propagate as a raw untyped error instead of a
  `ChartGoldPriceProviderError`. This does not break correctness — verified
  `FallbackMarketDataProvider`'s catch is untyped (`catch (err)`) and falls through
  regardless of error type — but the logged reason for that specific failure mode
  would be a raw parser exception message instead of a clean, typed one. Cosmetic;
  log it if not fixed inline.
- `packages/market-data/src/chartGoldPriceProvider.ts:130` — the returned
  `PriceUpdate.timestamp` uses `new Date().toISOString()` directly rather than the
  injectable `this.now()` used for the staleness comparison. No production impact
  (real clock either way), but it means the `now` injection point isn't fully
  deterministic for a test that wanted to assert an exact timestamp value. None of
  the current tests need this, so not blocking.

## Escalate to Architect
None. The known chartgoldprice.com staleness situation flagged in the Open
Questions section (14-hour-old feed at smoke-test time, meaning Binance will serve
essentially all ticks via fallback until the upstream feed updates) is correctly
identified by Bob as expected behavior given the design, already logged as KG-15,
and requires no code change — just post-deploy monitoring, which is Arch/owner's
job, not a blocker here.

## Cleared

**1. Staleness check (`chartGoldPriceProvider.ts`).** Verified line-by-line:
`updatedAtMs = updatedAt ? Date.parse(updatedAt) : NaN` correctly funnels both a
missing `meta.updated_at` and an unparsable one into the same `Number.isFinite`
guard, which throws a typed `STALE_DATA` error rather than silently treating a
missing timestamp as fresh. Comparison direction (`ageMs = now - updatedAtMs`,
`ageMs > threshold`) is correct — confirmed against the test at line 78-86 (16 min
old → stale) and the boundary test at line 88-95 (exactly 15 min → not stale, since
`>` not `>=`, matching the "more than 15 minutes" doc comment). Traced every
malformed-response path by hand and confirmed none can return NaN: HTTP error →
throw before parsing; missing/non-numeric `troy_ounce` → caught by
`Number.isFinite(price)` (this also correctly rejects strings, null, and objects,
not just NaN) → `INVALID_PRICE`; missing/malformed `updated_at` → `STALE_DATA`. All
four cases have a matching real test with a real `instanceof`/`.code` assertion, not
just "doesn't throw."

**2. FallbackMarketDataProvider (`fallbackProvider.ts`).** Confirmed the `for`
loop tries providers strictly in the constructor-supplied order, each iteration
wrapped in its own try/catch so one provider's rejection cannot prevent the next
from being tried, and every failure is both logged individually
(`console.error`) and pushed to an `errors` array. Confirmed the aggregate
`FallbackProviderError` thrown only when the loop exhausts contains every
individual error — both in `.errors` (array, in order) and folded into
`.message` — not just the last one; the "both fail" test asserts
`errors` equals `[primaryError, secondaryError]` and the message contains both
error strings. Traced the exact production scenario (ChartGoldPriceProvider
throws `STALE_DATA`, BinanceProvider succeeds): the success path is
`return await provider.getPrice(instrument)` — the winning provider's
`PriceUpdate` is returned completely untouched, no merging/spreading with the
failed attempt anywhere in the function. The "falls through to secondary" test
exercises this exact path and asserts `result.provider === "BINANCE"`, confirming
the returned data is genuinely Binance's, not corrupted.

**3. BinanceProvider untouched.** `git status --porcelain` and
`git diff HEAD -- packages/market-data/src/binanceProvider.ts` both confirm the
file isn't even part of the working-tree diff — zero changes since the last
commit that touched it (`c227b97`, Step 2 revision). The already-existing
`binanceProvider.test.ts` (6 tests) still passes unmodified.

**4. New tests exercise all three paths with real assertions.**
`fallbackProvider.test.ts`'s three tests map exactly to: primary succeeds →
fallback never invoked (asserts `secondary.getPrice` not called, and the exact
`.provider` value returned); primary fails → fallback succeeds (asserts the
winning `.provider` value, call count, and that the failure was logged); both
fail → aggregate error (asserts `instanceof`, `.code`, `.errors` array equality
against the exact original error objects, and message content). None of the
three rely on a bare "did not throw" — every one asserts specific returned/thrown
values. `chartGoldPriceProvider.test.ts`'s 8 tests likewise assert `.code` and
parsed values, not just absence of throw.

**5. tick/index.ts wiring change is isolated.** Full `git diff HEAD` reviewed:
every hunk is confined to (a) top-of-file comments, (b) new imports, (c)
`buildFallbackProvider` replacing `buildBinanceProvider` plus the new
`describeProviderError` helper, and (d) the price-fetch try/catch's error
branch, which now unwraps `FallbackProviderError.errors` instead of matching only
`BinanceProviderError`. No hunk touches `processPriceAlerts`, reminder
evaluation, or push-notification code — those sections don't appear in the diff
at all.

**6. No secrets.** `ChartGoldPriceProvider` reads no env var and needs no key
(confirmed by reading the full file — constructor only takes injectable
`fetchFn`/`now`, both defaulted to real globals). `tick/index.ts`'s diff
introduces no new `Deno.env.get` calls. Consistent with Binance's existing
keyless pattern.

**Independently re-ran** `pnpm --filter @tradeflow/market-data test`: 23/23 pass
(4 test files, matching Bob's claim exactly), confirming the numbers in the
Verification section rather than taking them on faith.

Signal to Arch: Step 7 is clear.

---

## Round 2 — 2026-09-11
Date: 2026-09-11
Ready for Builder: YES (no further action)

Re-reviewed after Bob's fix for both round-1 Should Fix items. Read
`chartGoldPriceProvider.ts` and its test file in full; did not re-review the
staleness/parsing/fallback logic already cleared above.

**1. Untyped `fetch`/`response.json()` — fixed, verified.** Lines 92-98 wrap
`this.fetchFn(url)` in try/catch, throwing `ChartGoldPriceProviderError` with the
new `NETWORK_ERROR` code and the underlying error's message folded in. Lines
115-121 wrap `response.json()` the same way, same code. `NETWORK_ERROR` is
correctly added to the `ChartGoldPriceProviderErrorCode` union. Confirmed
`tick/index.ts`'s `describeProviderError` (line 86-90) and
`fallbackProvider.ts`'s catch (generic `catch (err)`, untyped, line ~30 area)
both handle this with no code change: `describeProviderError` only checks
`instanceof ChartGoldPriceProviderError || instanceof BinanceProviderError` and
reads `.code`/`.message` generically, never switching on a specific code value —
so `NETWORK_ERROR` flows through exactly like the pre-existing codes. Bob's claim
that these two files needed no changes is correct on the merits, not just by
assertion.

**2. Timestamp now from injected `now()` — fixed, verified.** The return
statement uses `this.now().toISOString()`, and the staleness check above it uses
`this.now().getTime()` — same injected function, both call sites. In the test
suite `now` is a fixed-value closure (`() => NOW`), so both calls return the
identical `Date`, and the successful-parse test now asserts
`result.timestamp === NOW.toISOString()` exactly rather than "didn't throw." No
inconsistency between the staleness comparison and the returned timestamp is
possible from this change — they were already reading the same clock, this just
makes the returned value use it too.

**3. NETWORK_ERROR is genuinely tested.** Two new tests in
`chartGoldPriceProvider.test.ts`:
- `"throws ChartGoldPriceProviderError with NETWORK_ERROR when fetch itself rejects"` —
  `fetchFn` is `vi.fn().mockRejectedValue(new TypeError("fetch failed"))`, a real
  rejection, not a stub that returns an error object. Asserts `instanceof`,
  `.code === "NETWORK_ERROR"`, and `.message` contains the underlying error text.
- `"throws ChartGoldPriceProviderError with NETWORK_ERROR on a non-JSON response body"` —
  uses a real `Response("<html>not json</html>", ...)`, so `response.json()`
  genuinely throws a `SyntaxError` when parsing it, not a mocked throw. Asserts
  `instanceof` and `.code === "NETWORK_ERROR"`.

Both are real fault-injection cases with real assertions, not "doesn't throw"
placeholders.

**4. `fallbackProvider.ts` / `tick/index.ts` genuinely untouched.** `git status`
shows the whole Step 7 change is still one uncommitted working-tree diff against
the Step 6 commit (nothing from Step 7 has been committed yet), so a `git diff`
alone can't isolate "round-1 state" vs "round-2 fix" by commit boundary. Checked
two ways instead:
- File mtimes: `fallbackProvider.ts` (08:24) and `tick/index.ts` (08:26) both
  predate the round-2 fix work by a wide margin — `chartGoldPriceProvider.ts`
  itself was last saved at 08:57, its test file at 08:55, matching the fix
  session. Neither of the two claimed-untouched files was written to during that
  window.
- Content check: `describeProviderError` in `tick/index.ts` and the catch in
  `fallbackProvider.ts` are exactly as described in point 1 above — generic,
  code-value-agnostic, no `NETWORK_ERROR`-specific branch anywhere in either
  file. There would be nothing for Bob to add even if he'd wanted to.
Both confirm Bob's claim.

**5. Test count re-run independently.** `pnpm --filter @tradeflow/market-data test`:
4 test files, **25/25 pass** — `fallbackProvider.test.ts` (3), 
`chartGoldPriceProvider.test.ts` (10), `binanceProvider.test.ts` (6),
`oandaProvider.test.ts` (6). Matches Bob's claimed 25 exactly.

**Verdict: Step 7 is clear.**
