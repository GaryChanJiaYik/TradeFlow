# Review Feedback — Step 2 revision
*Written by Reviewer. Read by Builder and Architect.*

Date: 2026-08-31
Ready for Builder: YES

---

## Must Fix
[Blocks the step. Bob fixes before anything moves forward.]

- `apps/web/.env.local.example` — `git diff` shows this file was **not** left
  alone as Bob's own Files Changed table claims ("No change — confirmed it
  never had OANDA entries... a no-op here"). It actually gained two new
  lines, unrelated to this revision:
  ```
  # Finnhub API key for stock data. Get your own free key at https://finnhub.io/
  FINNHUB_API_KEY=your-finnhub-api-key-here
  ```
  Nothing in `handoff/ARCHITECT-BRIEF.md`'s Step 2 (revision) section
  mentions Finnhub or stock data — the brief's only instruction for this
  file is to remove OANDA placeholders and leave Web-Push entries alone.
  Confirmed this is dead weight, not a forgotten wire-up: `grep -rn
  "FINNHUB|finnhub"` across the repo (excluding `node_modules`) hits only
  this one line, and `packages/market-data/package.json` has no uncommitted
  changes (no new dependency, no stock-data provider file). This is
  undisclosed scope creep into an unrelated file, and the review request's
  description of that same file is factually wrong about its own diff —
  both need fixing. Fix: revert `apps/web/.env.local.example` to its
  pre-revision content (drop the Finnhub block entirely); if Finnhub
  support is a real future need, raise it as its own brief item, not
  smuggled into this one. Also correct the Files Changed table's claim
  once the revert is done.

## Should Fix
[Does not block. Fix inline if under 5 minutes, otherwise log to BUILD-LOG.]

None beyond the Must Fix above.

## Escalate to Architect
[Product or business decision required — not a code decision.]

None. The Finnhub addition is a straightforward revert, not a product
decision — nothing here requires Arch/owner input.

## Cleared

- `packages/market-data/src/binanceProvider.ts` — never returns `NaN`:
  price is parsed with `Number(body.price)` and gated by
  `body.price !== undefined && Number.isFinite(price)` before being
  returned; a non-200 response, a missing `price` field, or a non-numeric
  `price` field each throw a typed `BinanceProviderError` with a distinct
  `code` (`HTTP_ERROR` / `INVALID_PRICE`), and an unmapped instrument throws
  `UNKNOWN_INSTRUMENT` before any fetch happens — the same shape as
  `OANDAProviderError`, as the brief required.
- `packages/market-data/src/__tests__/binanceProvider.test.ts` — read in
  full; all 6 tests assert real outcomes, not tautologies: successful parse
  (checks `instrument`/`provider`/`price` value and the exact request URL),
  HTTP-error status, missing `price`, non-numeric `price`, unknown
  instrument (and asserts `fetchFn` was never called), and default-`fetch`
  construction. Matches the description in `REVIEW-REQUEST.md`.
- `supabase/functions/tick/index.ts` — diffed against the last commit
  (`git diff`). The only changed hunks are: the header comment, the
  `OANDAProvider`/`OANDAProviderError` import swapped for
  `BinanceProvider`/`BinanceProviderError`, `buildOandaProvider()` (which
  read `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID`/`OANDA_ENV`) replaced by a
  `buildBinanceProvider()` that takes no env vars, the call site, and the
  `err instanceof ...` check plus its log line. Grepped the whole file for
  `OANDA` afterward — one hit, a comment noting `OANDAProvider` stays
  unwired. No leftover `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID`/`OANDA_ENV`
  reads anywhere in the file. Everything else — `processPriceAlerts`,
  `processGraphReminders`, `pushToUserDevices`, and all surrounding
  structure — is outside the diff entirely, i.e. byte-for-byte identical to
  the already-cleared version; not re-reviewed in depth, only confirmed
  untouched via diff rather than assumed from the description.
- `packages/market-data/src/oandaProvider.ts` — confirmed present and
  unmodified (not in `git diff`, not deleted): still implements
  `OANDAProvider`/`OANDAProviderError` against the practice-only v20 REST
  endpoint, same `closeoutBid`/`closeoutAsk` validation pattern as before.
  Its test file is likewise untouched.
- `packages/market-data/src/index.ts` — the only change is the added
  `export * from "./binanceProvider"` line; the existing `oandaProvider`
  export is untouched, so `OANDAProvider` stays importable per the brief's
  "don't delete it" flag.
- `supabase/functions/.env.local.example` — the OANDA credential block is
  replaced with a comment explaining Binance needs no credentials and
  where `OANDAProvider` still lives; `VAPID_*` lines are untouched; no
  real-looking secret introduced.
- `README.md` / `docs/SETUP.md` — both accurately describe Binance as the
  active feed (with the PAXG-vs-spot tradeoff and the failed-broker
  history noted) and OANDA as built, reviewed, and kept for a future swap
  but not wired in; `docs/SETUP.md`'s local-verification `deno run` example
  correctly drops the `OANDA_*` env vars while keeping the `VAPID_*` ones.
  No real-looking secrets in either file.
- Repo-wide check: `grep` for `FINNHUB` (see Must Fix) is the only
  unexplained addition found; a separate check for
  `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID`/`OANDA_ENV` outside
  `oandaProvider.ts`/its test file/docs/handoff turned up nothing in any
  active code path, matching Bob's own verification claim.

---

## Round 2 (2026-08-31)

Date: 2026-08-31
Ready for Builder: YES

### Scope

Verifying only Bob's fix to the sole round-1 Must Fix (the `FINNHUB_API_KEY`
lines in `apps/web/.env.local.example` and the false "no change" claim about
that file). Nothing else from this revision was re-reviewed — it was already
cleared in round 1.

### Verification

- `git diff apps/web/.env.local.example` — empty output. Confirmed
  byte-for-byte identical to `HEAD`; the two Finnhub lines are gone.
- `git status` — `apps/web/.env.local.example` does not appear anywhere
  (not modified, not staged, not untracked), consistent with zero diff.
  Untracked files are only the two Binance additions already cleared in
  round 1 (`packages/market-data/src/binanceProvider.ts` and its test
  file). Nothing unexplained crept in.
- `handoff/REVIEW-REQUEST.md`'s Files Changed table no longer carries a row
  for `apps/web/.env.local.example`, matching the file having no diff to
  describe. The new "Review Fix (2026-08-31)" section accurately narrates
  what was found and fixed.

## Must Fix

None. Round-1 Must Fix is resolved.

## Cleared

- `apps/web/.env.local.example` — confirmed via `git diff` (empty) and
  `git status` (file absent from both modified and untracked lists) to be
  identical to `HEAD`. The round-1 finding is fully resolved: the
  undisclosed Finnhub lines are gone and the Files Changed table no longer
  misdescribes this file.

**Step 2 revision is clear.**
