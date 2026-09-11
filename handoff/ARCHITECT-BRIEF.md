# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 8 — Fast Binance-driven price-alert polling (10s), chartgoldprice demoted to accuracy check

Owner missed a real XAUUSD alert: price crossed the target and reverted within a
single 2-minute poll window. Root cause: `chartgoldprice.com` (Step 7's primary
source) only refreshes its own upstream data roughly once every 60 seconds — this
was independently reconfirmed against two more candidates the owner proposed
(`goldprice.dev`, `goldpricez.com`), both also capped near 60s or worse. Across 7
gold-price aggregators checked total in this project, every verifiable one caps out
around 60-second freshness — a structural property of that category of service.
Binance's PAXG ticker remains the only source that has ever demonstrated genuinely
continuous (per-trade) updates, which is why it's the one being polled faster, not
any aggregator. Confirmed technically: Supabase's cron scheduler supports a
`'N seconds'` schedule string (distinct from standard cron's 1-minute floor), making
10-second polling possible without an always-on server.

Full reasoning and confirmed decisions are in the approved plan; this brief is the
buildable version of that plan. Read the plan file if you want the full narrative:
`C:\Users\jychan\.claude\plans\this-is-my-project-nifty-mist.md` (optional — this
brief already contains what you need to build).

### Decisions

- **Two Edge Functions, not one with a branching flag** (reasoning: keeps every edit
  to the new hot path out of the same file as Step 6/7's already-reviewed reminder
  and hardening logic; gives separate per-function invocation/duration metrics for
  two very different volume profiles; allows independent tuning/rollback of the 10s
  path). Do not collapse these into one function.
- **`supabase/functions/tick-fast/index.ts`** (new): `new BinanceProvider().getPrice("XAUUSD")`
  directly — no `FallbackMarketDataProvider`, chartgoldprice never touched here. Move
  `processPriceAlerts` here **verbatim**, including Step 6's confirm-write-before-push
  ordering — do not weaken or reorder that hardening while moving it. Unconditionally
  update `instruments.last_price`/`last_price_at` on a successful Binance fetch — this
  function becomes the **sole writer** of that baseline going forward. Never reads or
  writes `graph_reminders`. On Binance failure: log and skip (self-corrects in 10s,
  no fallback needed).
- **`supabase/functions/tick/index.ts`** (narrowed, cron cadence unchanged at 2min):
  keep `processGraphReminders` **verbatim** — this is a regression-sensitive move, not
  a rewrite. Delete the current price-alert/fallback block entirely (including the
  `instruments` update call — this file must stop writing that baseline). Add
  `checkChartGoldPriceAccuracy`: `new ChartGoldPriceProvider().getPrice(...)`,
  **read-only** select of `instruments.last_price`/`last_price_at` (never update),
  compute and `console.log` the delta (absolute and %) between chartgoldprice and the
  Binance baseline — `console.log`, not `console.error`, this is routine observability
  not a failure. Surface it in the returned `summary.chartGoldPriceCheck`, matching
  the file's existing summary-shape convention. On failure or a null baseline (no
  `tick-fast` run yet): `{ skipped: true, reason }`, same pattern as today's other
  skip branches. `FallbackMarketDataProvider` becomes unused by any production path
  after this — leave it in place (still tested/exported), do not delete it.
- **`supabase/functions/_shared/notifications.ts`** (new): extract
  `getRequiredEnv`, `configureWebPush`, `PushResult`, `pushToUserDevices`,
  `logNotification`, `describeProviderError` from current `tick/index.ts`
  **byte-for-byte** — a mechanical move, not a rewrite, so it's reviewable as a pure
  diff. Both functions import from here instead of each having their own copy.
- **`supabase/migrations/0005_tick_fast_cron.sql`** (new): `cron.schedule('tick-fast-every-10-seconds',
  '10 seconds', $$ ... $$)`, body mirroring `0003_cron.sql`'s `net.http_post` structure.
  New Vault secret name: `tick_fast_function_url`. **Reuse** the existing
  `tick_function_service_role_key` Vault secret for the bearer token — do not create a
  second copy of the same credential. Include a comment documenting the one-time
  `vault.create_secret(...)` call for the URL that Arch runs manually post-deploy (same
  pattern as `0003_cron.sql`), and a documented `cron.unschedule(...)` rollback line.
  State explicitly in a comment that the existing `tick-every-2-minutes` job (job id 1)
  needs no changes — only the code behind its URL changes.
- **You cannot run `supabase db push` from this network** (blocks direct Postgres
  connections, per KG-8) — write the migration file, but Arch applies it manually via
  the dashboard SQL Editor after review. **Verify the `'10 seconds'` cron syntax
  actually registers against a local `supabase start` stack before considering this
  done** — this is the single riskiest unverified assumption in the whole step,
  matching how `0003_cron.sql` was verified locally before ever reaching production.

### Build Order
1. `_shared/notifications.ts` extraction (mechanical move).
2. `tick-fast/index.ts` — build, then verify locally against a throwaway `supabase start`
   stack with real Binance access: `instruments.last_price` updates each call, a real
   crossing fires correctly, `graph_reminders` provably untouched (diff before/after).
3. Narrow `tick/index.ts` — verify locally: reminders still process correctly, the
   chartgoldprice log line shows a plausible delta, and `instruments.last_price` is
   provably **unchanged** by this invocation (read before/after — this is the one
   thing that must not regress).
4. `0005_tick_fast_cron.sql` — verify the `'10 seconds'` schedule syntax registers
   locally before finalizing the file.
5. `handoff/BUILD-LOG.md` entry per this project's established process.

### Flags
- Flag: Do not let `processGraphReminders` or Step 6's write-before-push ordering
  drift while moving/editing code around them — these are regression-sensitive,
  already-proven-in-production pieces of logic.
- Flag: `tick-fast` must never call `FallbackMarketDataProvider` or touch
  chartgoldprice in any way — keeping it to one direct provider call is deliberate,
  to keep typical duration well under the 10s cadence (see the plan's overlapping-
  invocation risk discussion — no advisory-lock guard is being added preemptively).
- Flag: Do not invent a new table/log for the chartgoldprice accuracy check —
  `console.log` + the response summary is sufficient, per the plan.

### Definition of Done
- [ ] `deno check` clean on both `tick/index.ts` and `tick-fast/index.ts`.
- [ ] `pnpm build`/`test`/`typecheck` pass (no-op regression check — no package
      internals should change).
- [ ] Local verification of all four points in Build Order steps 2-4 actually
      performed and documented, not just "code looks right."
- [ ] Migration file written and locally verified, not yet applied to the live
      project (Arch does that after review).

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

**Approach** — five files, in Build Order order:

1. **`supabase/functions/_shared/notifications.ts`** (new) — byte-for-byte cut of
   `getRequiredEnv`, `configureWebPush`, `PushResult`, `pushToUserDevices`,
   `logNotification`, `describeProviderError` out of current `tick/index.ts`
   (lines 86-213 roughly). Only change from a pure copy-paste: add the two
   `export` keywords each already-top-level function/type needs so both
   functions can import them, and keep the `ChartGoldPriceProviderError`/
   `BinanceProviderError` imports `describeProviderError` needs. No logic
   touched.
2. **`supabase/functions/tick-fast/index.ts`** (new) — `Deno.serve` handler:
   read `XAUUSD` instrument, `new BinanceProvider().getPrice("XAUUSD")`
   directly (no fallback wrapper), run `processPriceAlerts` (moved verbatim
   from current `tick/index.ts` lines 215-295, including the Step 6
   confirm-write-before-push ordering — copied unchanged, only its imports
   adjusted), then unconditionally update `instruments.last_price`/
   `last_price_at` on a successful fetch. On Binance failure: `console.error`
   + `summary.priceAlerts = { skipped: true, reason }`, no fallback, no
   `graph_reminders` access anywhere in this file. Own `deno.json` inherited
   from the shared one at `supabase/functions/deno.json` (Deno resolves
   config from the nearest ancestor — same as `tick/`, no new config file
   needed, verified during build).
3. **`supabase/functions/tick/index.ts`** (narrowed) — remove
   `buildFallbackProvider`, `processPriceAlerts`, and the whole "Price tick +
   price_alerts" block including its `instruments` update call. Keep
   `processGraphReminders`, `timeStringToMinutes`, `buildReminderWindowArg`
   verbatim. Add `checkChartGoldPriceAccuracy(supabase)`: calls
   `new ChartGoldPriceProvider().getPrice("XAUUSD")`, does a read-only
   `select last_price, last_price_at from instruments where symbol =
   'XAUUSD'`, computes `delta = chartgoldprice.price - instrument.last_price`
   (absolute and `%`), `console.log`s it, returns the numbers for
   `summary.chartGoldPriceCheck`. Null baseline (`last_price === null`, i.e.
   `tick-fast` hasn't run yet) or either fetch/select failing →
   `{ skipped: true, reason }`. Imports switch to `_shared/notifications.ts`.
   `FallbackMarketDataProvider` untouched/unimported here — left as dead-in-
   production code per the brief, not deleted.
4. **`supabase/migrations/0005_tick_fast_cron.sql`** (new) — mirrors
   `0003_cron.sql`'s structure exactly: `cron.schedule('tick-fast-every-10-
   seconds', '10 seconds', $$ net.http_post(...) $$)`, reading
   `tick_fast_function_url` (new secret, documented one-time
   `vault.create_secret` comment, not created here) and the *existing*
   `tick_function_service_role_key` (reused, not duplicated). Comment stating
   job id 1 (`tick-every-2-minutes`) needs no changes, plus a documented
   `select cron.unschedule('tick-fast-every-10-seconds');` rollback line.
5. Update `handoff/BUILD-LOG.md`.

**Local verification plan** (throwaway `supabase start` via `npx supabase`,
Docker confirmed running; Deno 2.9.6 and outbound network access to both
`data-api.binance.vision` and `www.chartgoldprice.com` confirmed reachable
from this environment):
- Per KG-5 (Step 2), `supabase functions serve` was previously unreliable on
  this Windows+Docker setup for functions with relative imports reaching
  outside `supabase/functions/` — will retest it first, and fall back to the
  same proven workaround (`deno run` directly against the local stack's
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from `supabase status -o json`)
  if it still doesn't work, same as prior steps.
- Start the stack, apply `0001`-`0004` migrations (already-proven), confirm
  `instruments.last_price` starts `null`.
- Run `tick-fast` once for real against live Binance: assert
  `instruments.last_price`/`last_price_at` updated, `graph_reminders` table
  row-for-row identical before/after (diff a full select).
- Seed one `price_alerts` row with a target crafted to be crossed by the next
  real Binance tick (or seed `instruments.last_price` just below/above the
  live price first) and confirm it fires exactly once and `last_triggered_at`
  is set.
- Run narrowed `tick` once: assert `graph_reminders` due rows still advance
  `next_trigger_at` and a push/log fires as before; assert
  `instruments.last_price`/`last_price_at` are byte-identical before/after
  (read, run, read, diff); assert `summary.chartGoldPriceCheck` logs a
  plausible delta against the Binance baseline `tick-fast` just wrote.
- Apply `0005_tick_fast_cron.sql` locally and confirm `select * from
  cron.job where jobname = 'tick-fast-every-10-seconds'` shows `schedule =
  '10 seconds'` and the job is active — the specific syntax-registers check
  the brief calls out as the riskiest assumption.
- Tear down the local stack afterward (`supabase stop`); no real project
  touched, consistent with every prior step's local-only verification.

**Uncertainties / none blocking** — no ambiguity found in the brief; proceeding
directly to build per the "background run" instruction rather than waiting
for interactive Architect sign-off on this plan.

Architect approval: [ ] Approved / [ ] Redirect — see notes below
