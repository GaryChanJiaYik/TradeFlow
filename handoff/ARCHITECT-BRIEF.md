# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 12 — Replace chartgoldprice.com with goldprice.dev as tick's calibration reference

chartgoldprice.com (Step 9's calibration reference for Binance's PAXG-vs-spot basis)
was observed genuinely stale for 8+ hours at a time on three separate occasions
across this project's history (confirmed each time via a cache-busted direct fetch —
`X-Vercel-Cache: MISS`, ruling out a caching artifact). This is now a confirmed
chronic pattern, not an occasional outage — which matters because it changes the
calculus from Step 10 (GoldAPI.io was rejected as a *fallback* partly because a
chronic-failure chartgoldprice would exhaust its 100/month keyed quota in hours).

With Step 11 live, chartgoldprice's role had already shrunk to calibrating only the
Binance fallback path (MT4/TMGM is now primary), lowering the stakes of this fix —
but a genuinely reliable, still-keyless replacement removes the problem outright
rather than just accepting degraded fallback accuracy.

Researched and verified live: **goldprice.dev** (`api.goldprice.dev`, a separate
subdomain from its marketing site — the real endpoint, not guessed). Keyless, no
signup. Free/anonymous tier: 100 requests/hour/IP, comfortably above `tick`'s 30/hour
(2-minute cadence) usage. Self-reports freshness via an `is_stale` boolean plus a
`computed_at` timestamp. Verified with a live call at design time: `computed_at` was
~1 second old. Already indirectly vetted once before in this project (the Step 2
revision re-verified it and rejected it only for being too slow for the old
10-second hot path — irrelevant here, since calibration only needs ~60s-level
freshness). One honest caveat: it's a new service ("Launched May 2026"), so it lacks
chartgoldprice's longer (if apparently worthless) track record.

### Decisions

- **Full replacement, not an added fallback.** Simpler than a dual-source design
  (which is what sank Step 10) since goldprice.dev is keyless and handles the full
  2-minute cadence directly — no quota-conservation logic needed.
- **New `packages/market-data/src/goldPriceDevProvider.ts`**, mirroring
  `ChartGoldPriceProvider`'s exact shape (typed errors, `fetchFn`/`now` injection,
  never propagate NaN/stale). Staleness check trusts the API's own `is_stale` flag
  primarily, but ALSO independently checks `computed_at` age against a 5-minute
  backstop threshold — never trust a single external signal blindly, matching this
  codebase's existing pattern.
- **`ChartGoldPriceProvider` left in place, unused** — same convention as
  `OANDAProvider`/`FallbackMarketDataProvider`. Not deleted, not imported anywhere
  in the active path.
- **`tick/index.ts`**: `checkChartGoldPriceAccuracy` renamed to
  `checkPriceBasisAccuracy` (the function's job — compute and write a basis — hasn't
  changed, only the reference source; the old name was source-specific). Variable
  names, log lines, and the returned summary key (`chartGoldPriceCheck` ->
  `priceBasisCheck`) updated to match — these are purely observability-facing, not
  consumed by any other code, so free to rename.
- **`_shared/notifications.ts`**: `describeProviderError` gains recognition of
  `GoldPriceDevProviderError` alongside the existing `ChartGoldPriceProviderError`/
  `BinanceProviderError` — kept both since the shared formatter's job isn't scoped
  to one caller's active path.
- No schema change — reuses Step 9's `price_basis`/`price_basis_at` columns
  unchanged.

### Build Order
1. `goldPriceDevProvider.ts` + tests (mirrors `chartGoldPriceProvider.test.ts`'s
   exact structure: success, network/HTTP/JSON errors, missing/non-numeric price,
   `is_stale: true` even with a fresh timestamp, missing/stale `computed_at` even
   with `is_stale: false`, boundary case, default-fetch construction).
2. Export from `packages/market-data/src/index.ts`.
3. Rewire `tick/index.ts` (rename function, swap provider, update all
   chartgoldprice-referencing comments in `tick/index.ts` AND `tick-fast/index.ts`,
   since the latter's basis-application comments also named the old source).
4. `_shared/notifications.ts`'s `describeProviderError` update.
5. Local verification: real live call against goldprice.dev + Binance (no mocking
   needed — fully keyless, zero quota risk) against a throwaway `supabase start`
   stack, confirming a real basis computes and writes correctly.
6. `handoff/BUILD-LOG.md` entry.

### Flags
- Flag: goldprice.dev is new (launched May 2026) — if it turns out unreliable too,
  don't reflexively reach for another 3rd-party gold API next; consider whether the
  Binance fallback path even needs basis correction badly enough to justify a fourth
  attempt, now that it's genuinely just a fallback-of-a-fallback behind MT4.
- Flag: do not let `processGraphReminders` drift while editing around it in the same
  file — unrelated, already-proven-in-production logic.

### Definition of Done
- [ ] `deno check` clean on `tick/index.ts`, `tick-fast/index.ts`.
- [ ] `pnpm build`/`test`/`typecheck` pass, new provider's tests included and green.
- [ ] Local verification against a real live goldprice.dev + Binance call actually
      performed and documented (not just unit-tested), confirming a real basis
      write.
- [ ] Deployed to production (`supabase functions deploy tick`) and confirmed via
      the dashboard/DB that a real basis updates within one 2-minute cycle.

---
