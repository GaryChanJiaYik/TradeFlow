# Review Request — Step 2 (revision): Swap active price feed from OANDA to Binance PAXG
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## Context

This is a pre-deployment correction to the already-reviewed Step 2, not a new step
(per `handoff/ARCHITECT-BRIEF.md`, not renumbered). Step 2 was built and cleared
against OANDA but never deployed — no real OANDA credentials were ever used. The
owner's OANDA practice-account signup, and two alternative broker demo APIs
(Capital.com, Deriv), all failed for reasons outside our control after trying 12
data providers total. The owner decided to use Binance's public PAXG/USDT ticker
as V1's XAUUSD source instead — a real, informed tradeoff (PAXG is a gold-backed
crypto token, not literally spot gold, and has historically run ~0.1-0.3% off an
OANDA-sourced reference), with no offset/calibration attempted (explicitly
rejected — the basis isn't constant and there's no free live OANDA reference to
calibrate against).

Full narrative and verification detail: `handoff/BUILD-LOG.md`'s new "Step 2
(revision)" entry.

## Review Fix (2026-08-31)

Richard's review of the above found one Must Fix: `apps/web/.env.local.example`
had gained two unrelated lines (a `FINNHUB_API_KEY` placeholder and its
comment) that were never part of this task's scope, and the Files Changed
table below wrongly claimed "no change" for that file. Fixed: removed the two
Finnhub lines. `git diff` now shows **no diff at all** for
`apps/web/.env.local.example` — it is byte-for-byte identical to `HEAD` — so
its row has been dropped from the Files Changed table entirely rather than
corrected to describe a change. Re-ran `pnpm build`, `pnpm test`,
`pnpm typecheck` at repo root: all still green (29 tests), unaffected by the
revert as expected. See `handoff/BUILD-LOG.md`'s "Review fix" note under the
Step 2 (revision) entry for the same detail.

## What Was Built

- **New `BinanceProvider`** implementing `MarketDataProvider` against Binance's
  public, keyless `data-api.binance.vision` ticker endpoint — no API key, secret,
  or env var of any kind. Parses the `price` string field, throwing a typed
  `BinanceProviderError` (never `NaN`) on an HTTP error or a missing/non-numeric
  `price` field, mirroring `OANDAProviderError`'s pattern.
- **`OANDAProvider` left completely untouched** — not wired into anything active,
  not deleted, per the brief's explicit flag. Its own tests still pass unchanged.
- **`tick` Edge Function** swapped its one provider call site from OANDA to
  Binance and dropped the now-dead `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID`/`OANDA_ENV`
  env reads. No other logic in the file touched — alert evaluation, push sending,
  and reminder handling are byte-for-byte identical to the already-reviewed version.
- **Docs and env-var templates** updated to reflect Binance as the active source
  and OANDA as a documented, unwired future option.

## Files Changed

| File | Change |
|---|---|
| `packages/market-data/src/binanceProvider.ts` | New — `BinanceProvider`/`BinanceProviderError`, keyless Binance ticker client, maps `XAUUSD` -> `PAXGUSDT`. |
| `packages/market-data/src/__tests__/binanceProvider.test.ts` | New — 6 tests: successful parse, HTTP error, missing `price`, non-numeric `price`, unknown instrument (no fetch call), default-`fetch` construction. |
| `packages/market-data/src/index.ts` | Added `export * from "./binanceProvider"`. |
| `packages/market-data/src/oandaProvider.ts`, `src/__tests__/oandaProvider.test.ts` | Unchanged — kept in the codebase per the brief's flag, not wired in. |
| `supabase/functions/tick/index.ts` (lines ~1-49, ~276-292, ~294-295) | `buildOandaProvider()` -> `buildBinanceProvider()` (no env reads); import and `catch`-block error-type check switched from `OANDAProvider(Error)` to `BinanceProvider(Error)`; header/inline comments mentioning OANDA updated to Binance. All alert-evaluation, push-sending, and reminder-processing logic untouched. |
| `supabase/functions/.env.local.example` | Removed the `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID`/`OANDA_ENV` block; replaced with a comment noting no price-feed credentials are needed on the active path. `VAPID_*` entries untouched. |
| `README.md` | Status section reflects Binance as the active feed; Structure section's `market-data`/`functions/tick` lines updated; COST/FREE TIER section's OANDA entry replaced with a Binance entry (free/keyless, per-IP rate limit, failure behavior, alternative-provider note) plus a short OANDA entry documenting it as built-and-reviewed-but-unwired. |
| `docs/SETUP.md` | Removed the "fill in fake OANDA credentials" step and the OANDA env vars from the `deno run` local-verification example; added a short note on where `OANDAProvider` exists and what wiring it back in later would involve. |
| `handoff/BUILD-LOG.md` | New "Step 2 (revision)" entry; Current Status updated to reflect the swap and that the OANDA-credentials blocker no longer applies. |

## Verification

- `pnpm build`, `pnpm test`, `pnpm typecheck` — all green at repo root. 29 tests
  total (8 alert-engine + 9 validation + 12 market-data: 6 Binance + 6 OANDA).
- `deno check --config supabase/functions/deno.json supabase/functions/tick/index.ts`
  — clean, no type errors (this file isn't covered by the pnpm-workspace
  `typecheck` task since it's Deno).
- Live `curl` to `https://data-api.binance.vision/api/v3/ticker/price?symbol=PAXGUSDT`
  during this session returned a real price, reconfirming Arch's earlier finding
  that the endpoint is up and needs no auth.
- Grepped the whole repo (excluding `node_modules`) for
  `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID`/`OANDA_ENV`: no hits in any active code
  path — only in `docs/SETUP.md`'s intentional "how to wire OANDA back in" note
  and historical handoff docs (`ARCHITECT-BRIEF.md`, `BUILD-LOG.md`,
  `SESSION-CHECKPOINT.md`), plus `oandaProvider.ts`/its own test file as expected.

## Open Questions

None. This revision is narrowly scoped and every Decision/Flag in the brief was
followed as written; no ambiguity was hit.

## Known Gaps Logged

None new this session. Pre-existing gaps (KG-2 through KG-7 in `handoff/BUILD-LOG.md`)
are unchanged and unrelated to this revision.

**Ready for Review: YES**
