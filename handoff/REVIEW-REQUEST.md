# Review Request — Step 8: Fast Binance-driven price-alert polling (10s), chartgoldprice demoted to accuracy check
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

## Fix Round (Richard's round-1 review, 2026-09-11)

- **Must Fix — done.** `supabase/functions/tick/index.ts:185` — `checkChartGoldPriceAccuracy`'s catch-block skip/failure log changed from `console.log` to `console.error`, matching every other failure branch's convention in this codebase (Binance fetch failures, `FallbackProviderError`, `processGraphReminders` write failures all use `console.error` unconditionally). The success-path delta-comparison log (the line above it) is unchanged — that one correctly stays `console.log`. One line changed, no other logic touched.
- **Should Fix — build-report wording corrected, no code change.** Richard diffed this report's "verbatim"/"byte-for-byte" claims against commit `136a76e` and found two one-sentence comment rewordings (zero logic change in either case). Corrected below, in the "What Was Changed" section, and see the fuller callout in `handoff/BUILD-LOG.md`'s Step 8 entry.
- **Re-verification:** `pnpm build` (5/5 tasks), `pnpm test` (6/6 tasks, 94/94 tests — unchanged count), `pnpm typecheck` (8/8 tasks) at repo root all green. `deno check --node-modules-dir=auto` clean on both `tick/index.ts` and `tick-fast/index.ts`. No files touched beyond the one-line fix and this handoff-doc correction.

---

## Context

Owner missed a real XAUUSD alert crossing that reverted within a single 2-minute poll
window — root cause: every gold-price aggregator checked so far (7 total across this
project) caps out around 60-second freshness. Binance's PAXG ticker is the only source
with genuinely continuous updates, so it's now polled every 10 seconds via a new,
separate Edge Function, while the existing 2-minute `tick` function keeps reminders and
gains a read-only chartgoldprice.com accuracy check. Full detail:
`handoff/ARCHITECT-BRIEF.md`'s Step 8.

Builder Plan (written before building, per BUILDER.md, background run):
`handoff/ARCHITECT-BRIEF.md`'s Builder Plan section. Full verification detail:
`handoff/BUILD-LOG.md`'s new Step 8 entry.

## What Was Changed

**New files:**
- `supabase/functions/_shared/notifications.ts` (full file, 134 lines) —
  extraction of `getRequiredEnv`, `configureWebPush`, `PushResult`,
  `pushToUserDevices`, `logNotification`, `describeProviderError` out of the
  pre-Step-8 `tick/index.ts`. Why: both `tick` and the new `tick-fast` need the same
  push/logging plumbing; a shared module keeps it as one reviewable copy instead of
  two drifting ones. `getRequiredEnv`, `configureWebPush`, `PushResult`,
  `pushToUserDevices`, and `logNotification` are byte-for-byte (only `export` added).
  **Correction from this report's original wording:** `describeProviderError` is
  logic-verbatim but its doc comment was reworded ("Formats one provider-level error
  for the tick response summary" -> "...for a function's response summary", since it
  now serves two callers) — zero behavior change, but the original claim of "only
  export keywords added, no logic changed" for this file was not literally accurate
  for that one comment.
- `supabase/functions/tick-fast/index.ts` (full file, 182 lines) — new Edge Function,
  the 10-second hot path. `processPriceAlerts` (lines 44-124) is moved **verbatim**
  from the pre-Step-8 `tick/index.ts`, including Step 6's confirm-write-before-push
  ordering (the `update(...)`/confirm-before-push block within it). The `Deno.serve`
  handler (lines 126-182) fetches
  `XAUUSD` -> `new BinanceProvider().getPrice(...)` directly (no fallback, no
  chartgoldprice access anywhere in this file), runs `processPriceAlerts`, then
  unconditionally writes `instruments.last_price`/`last_price_at` on success — this
  function is now the sole writer of that baseline. On Binance failure: logs and
  skips, no retry/fallback logic (self-corrects in 10s). Never reads or writes
  `graph_reminders`.
- `supabase/migrations/0005_tick_fast_cron.sql` (full file, 77 lines) —
  `cron.schedule('tick-fast-every-10-seconds', '10 seconds', ...)`, structurally
  mirroring `0003_cron.sql`. Reuses the existing `tick_function_service_role_key`
  Vault secret for the bearer token (not duplicated); introduces a new
  `tick_fast_function_url` secret (documented one-time `vault.create_secret(...)`
  comment for Arch to run post-deploy, not created by this file). Documents that job
  id 1 (`tick-every-2-minutes`) needs no changes, plus a documented
  `cron.unschedule(...)` rollback line.

**Modified files:**
- `supabase/functions/tick/index.ts` (was 422 lines, now 218 lines) — narrowed to
  reminders + a read-only accuracy check. Removed: `buildFallbackProvider`,
  `processPriceAlerts`, and the entire "Price tick + price_alerts" block from the
  `Deno.serve` handler, including its `instruments` update call — this file no
  longer writes `instruments` at all. Kept **verbatim**:
  `timeStringToMinutes`/`buildReminderWindowArg` (lines 63-76). `processGraphReminders`
  (lines 78-144) is logic-verbatim (its function body, lines 79-132, diffed clean
  against `136a76e`), but its in-loop comment was reworded — "Same ordering
  requirement as processPriceAlerts: advance" -> "Same ordering requirement as
  processPriceAlerts (tick-fast): advance", reflecting that `processPriceAlerts`
  actually moved to `tick-fast` — a correction from this report's original
  "verbatim" claim; zero behavioral difference. Added `checkChartGoldPriceAccuracy`
  (lines 146-188): calls `new ChartGoldPriceProvider().getPrice("XAUUSD")`, does a
  read-only select of `instruments.last_price`/`last_price_at`, computes and
  `console.log`s the delta (absolute + %) against that Binance baseline, surfaces it
  as `summary.chartGoldPriceCheck`. Null baseline or any failure ->
  `{ skipped: true, reason }`, logged via `console.error` (fixed from `console.log`
  per Richard's Must Fix — see Fix Round above). Imports switched to
  `_shared/notifications.ts`.
  `FallbackMarketDataProvider` is now unused by any production path but left in
  place, per the brief (not deleted).

## Why

- Two separate Edge Functions (not one file with a branching flag) per the brief's
  explicit decision: keeps the new 10s hot path out of the same file as Step 6/7's
  already-reviewed reminder/hardening logic, and gives each independent
  invocation/duration metrics.
- `processPriceAlerts` and Step 6's write-before-push ordering were moved, not
  rewritten, because both are regression-sensitive, already-proven-in-production
  logic per the brief's explicit flag.
- chartgoldprice.com is demoted to a non-authoritative accuracy check (not deleted)
  because Binance is now the sole price-alert/baseline source, but comparing against
  a real-spot-gold feed is still useful signal, per the brief.

## Decisions Made (flagging for review)

- **Resolved by Richard's round-1 review.** `checkChartGoldPriceAccuracy`'s
  failure/skip branch originally logged via `console.log`, not `console.error`. The
  brief said the *delta* log line should be `console.log` since "this is routine
  observability not a failure" — that reasoning was extended to the skip/failure
  branch too, since a stale or unreachable chartgoldprice.com is an anticipated,
  non-critical condition here (this project's own KG-15 already found chartgoldprice
  stale in real-world testing). Richard's review found this didn't hold: every other
  genuine-failure branch in this codebase (Binance fetch failures,
  `FallbackProviderError`, `processGraphReminders` write failures) uses
  `console.error` unconditionally, with no carve-out for "anticipated" failures —
  this branch was the one place that broke that convention, and Supabase's
  error-level log filter wouldn't surface it as a result. Fixed: now `console.error`.
  The success-path delta log stays `console.log`, unchanged.
- Delta is computed as `chartGoldPrice.price - baselinePrice` (chartgoldprice minus
  Binance) — arbitrary sign choice, documented in a code comment.

## Local Verification (real, not code-read-through)

Full detail in `handoff/BUILD-LOG.md`'s Step 8 entry. Summary:
- `deno check` clean on all three Deno files.
- `pnpm build`/`test`/`typecheck` at repo root — all green (94 tests), confirming no
  package internals changed (no-op regression check).
- Throwaway `npx supabase start` (Docker) stack, `supabase db reset` applied
  `0001`-`0005` cleanly. `select * from cron.job` confirmed job 1
  (`tick-every-2-minutes`) untouched and a **new, separate** job 2
  (`tick-fast-every-10-seconds`, schedule literally `10 seconds`, active) —
  confirming the brief's single riskiest assumption (the `'10 seconds'` pg_cron
  syntax) for real.
- Ran `tick-fast` for real against **live Binance** (`deno run` against the local
  stack, per KG-5's known `supabase functions serve` limitation on this
  Windows+Docker setup): a seeded price-alert crossing fired correctly
  (`evaluated:1, triggered:1`), `instruments.last_price`/`last_price_at` updated to
  the real live Binance price and advance on every call, and `graph_reminders` was
  confirmed **byte-for-byte identical** before/after via a full-table diff.
- Ran narrowed `tick` for real: the due reminder correctly advanced
  `next_trigger_at` (`evaluated:1, triggered:1`), and `instruments` was confirmed
  **byte-for-byte identical** before/after via a full-row diff — proving `tick` no
  longer writes that baseline. The live chartgoldprice.com feed was genuinely stale
  at test time (same real condition as KG-15), so the actual run exercised the real
  skip branch end-to-end; separately confirmed the success-path delta arithmetic is
  plausible using chartgoldprice.com's real current price against the real Binance
  baseline (`delta=40.5700`, `0.9317%` — a sane sub-1% real-gold-vs-PAXG spread).
- Local stack torn down after (`npx supabase stop`); no real project touched.

## Open Questions / Uncertainties

1. Resolved — see "Decisions Made" above re: `console.log` vs `console.error` on the
   chartgoldprice accuracy check's failure branch; fixed per Richard's Must Fix.
2. Not yet deployed or committed (per BUILDER.md, deploy/commit happen after
   review). `supabase/migrations/0005_tick_fast_cron.sql` cannot be applied via
   `supabase db push` from this network (KG-8, unchanged) — Arch applies it via the
   dashboard SQL Editor after review, same as every prior migration. `tick-fast`
   also needs `supabase functions deploy tick-fast` and a new
   `tick_fast_function_url` Vault secret created (documented in the migration file's
   comment) before its cron job can succeed against the real project.
3. No new Known Gaps logged this step beyond the deploy/apply status above (see
   `handoff/BUILD-LOG.md`'s Current Status section for the full pending-deploy list).
