# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** Step 11 — Supabase side DEPLOYED and confirmed ACTIVE (2026-09-16). VPS provider switched from OCI to GCP (`ap-kulai-2` doesn't offer any Always-Free x86 shape — see Step History). MQL4 EA/VPS side still entirely unverified.
**Last cleared:** Step 8 — 2026-09-11 (deployed and verified live).
**Blocked on:** Step 11's real-world completion is gated on the owner: provisioning the GCP e2-micro VPS, compiling `mt4/TradeFlowMt4Bridge.mq4` for the first time, and the several GUI-only MT4 setup steps in `mt4/README.md` — none of which can be done from this session. The deployed Supabase-side code doesn't regress anything if the VPS/EA never materializes (falls back to today's Binance-only behavior).

### Known Gaps
- **KG-16** — An unexplained `"workspaces": ["apps/*", "packages/*"]` field has now appeared in root `package.json` three separate times across three different Bob sessions (Step 7's build, Step 8's build, this fix round was clean), always byte-identical, always reverted before commit. Harmless (pnpm ignores this field entirely — it's the npm/yarn workspaces convention), but the recurrence across independent sessions suggests some tool invoked during a Bob session (candidate: a `deno check`/`deno run` command executed from the repo root rather than scoped into `supabase/functions`, which also produced a stray root-level `deno.lock` this same session, deleted before commit) is auto-adding it, though this hasn't been confirmed. Worth investigating properly if it keeps recurring; not blocking any step so far.
**Note:** an unexplained, unreviewed `"workspaces"` field appeared in root `package.json` during Step 7's build session — not part of anything in the brief or Bob's own reports. Reverted before commit (pnpm doesn't use that field anyway; it's the npm/yarn convention). Worth a closer look if it recurs.

### Known Gaps (added from Step 6's review)
- **KG-13** — Step 6's duplicate-notification fix was proven via a genuine forced-failure test (REVOKE privileges on a local stack) but that test isn't committed as an automated regression check, so the proof isn't repeatable in CI. A lightweight mocked-Supabase-client unit test would close this; deferred as non-blocking (would mean introducing new test infrastructure for a file that currently has none, contrary to Step 6's own scoping).
- **KG-14** — Of Step 6's three lower-severity error-checked writes, only the two duplicate-risk paths were independently force-failed and verified; the device-disable and `instruments.last_price` writes were verified by code-pattern inspection only (same shape as the verified ones), not independently forced. Low risk, logged for completeness.
**Pending deploy:** Steps 1-7 LIVE (Steps 1-5 as of 2026-09-02; Step 6+7's `tick/index.ts` redeployed and confirmed healthy per commit 65549e8). Local git commits: 766bc6c, eae9166, 461634e (Step 1), 0df58cd, 01b4719 (Step 2), c227b97, cc6bfba (Step 2 revision), 060cdca (Cloudflare deploy fix), 2c253d8 (Step 3), 0f21a9e (Step 4), 925a612 (Step 5), 49e6b74 (Step 6), 136a76e (Step 7), 036a741 (Step 8). **Step 8 is now LIVE and verified** — `tick-fast` deployed (Edge Function `ACTIVE`, version 1) and `tick` redeployed (version 7, narrowed); `0005_tick_fast_cron.sql` applied manually via the dashboard SQL Editor (`tick_fast_function_url` Vault secret created, reusing existing `tick_function_service_role_key`). Verified live 2026-09-11 07:50 UTC: `cron.job` shows `tick-fast-every-10-seconds` active on schedule `'10 seconds'`; `cron.job_run_details` shows 10 consecutive runs exactly 10s apart, all `status: succeeded`, each returning `1 row`; `instruments.last_price_at` for XAUUSD observed advancing in step with the cron cadence (last_price 4346.97 at 07:50:53.411 UTC, ~20s after the last logged run, consistent with two further successful ticks). No `graph_reminders`/`instruments` write-ownership regression reported.

### Milestone 1 Proof — 2026-08-31

The spec's primary success criterion (section 29/41): "Can I create an XAUUSD price
alert and receive a notification when the cloud detects the price crossing my target
while my Windows laptop is completely OFF?" — **YES, confirmed.**

Test performed: owner created a real account (`gary@gary.com`) on the deployed app,
created a `price_alerts` row (target `4439`, `CROSS_BOTH`, `ONCE`, message "Milestone
1 test") when the live PAXG/USDT price was `4438.80`, registered a Web Push device
from their **phone's** browser (not the laptop — the first registration attempt was
from the laptop and correctly identified as not sufficient for this proof, since a
laptop-tied push subscription can't be delivered to while the laptop is off), then
closed the browser and powered off the laptop entirely.

Verified server-side (queried via the Supabase REST API using the test account's own
session, independent of the owner's laptop):
- `price_alerts`: `enabled` flipped to `false`, `last_triggered_at` set to
  `2026-08-31T07:22:00.727Z` — ONCE mode correctly consumed the alert.
- `notification_log`: one `PRICE_ALERT` row, `status: SENT`, message "XAUUSD crossed
  4439 upward. Milestone 1 test", `sent_at` matching `last_triggered_at` to the second.
- `instruments.last_price` progressed `4436.11` (at alert creation time) ->
  crossed 4439 -> `4442.66` (two ticks later), confirming the cron worker was
  continuously polling and the crossing was genuine, not a fluke single reading.
- Owner independently confirmed receiving the actual push notification on their phone
  while the laptop was off.

This proves the full vertical slice end-to-end in production: Binance price feed ->
pg_cron-scheduled Edge Function -> `evaluatePriceAlert` -> Web Push -> phone, with
zero dependency on the owner's laptop, browser, or any running local process.

### Deployment — 2026-08-31

**Supabase (live project `pepizbjtpclypgfzkole`):**
- `tick` Edge Function deployed via `supabase functions deploy` (HTTPS-based Management API — worked fine).
- VAPID secrets set via `supabase secrets set`. `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase for every deployed function — not set manually.
- `pg_cron`/`pg_net` extensions and the two Vault secrets (`tick_function_url`, `tick_function_service_role_key`) were applied via the dashboard **SQL Editor** by the owner, not `supabase db push` — direct Postgres connections (ports 5432/6543) are blocked on the owner's network (confirmed via raw TCP tests; HTTPS/443 works fine), so the CLI's direct-DB-connection commands (`db push`, `migration list`) cannot run from this machine. `cron.schedule` returned job id `1` — the schedule is registered and firing every 2 minutes.
- **Known gap (KG-8):** `0001_init.sql`/`0002_rls.sql` were applied earlier (Step 1, before this network restriction was identified) and `0003_cron.sql`'s DDL was hand-run via SQL Editor — but the migration files themselves were never applied via `supabase db push`, so the CLI's migration-history table doesn't know about them. Future migrations will need the same manual SQL Editor approach, or running `db push` from a network without the port block, until/unless this is resolved.

**Cloudflare (Workers, via `@opennextjs/cloudflare`):**
- Account had no `workers.dev` subdomain registered yet — resolved by the owner via the dashboard (`garychanjiayik.workers.dev`), not something the CLI or API could do non-interactively (a direct API attempt using wrangler's stored OAuth token returned an auth error — that token isn't usable for direct Cloudflare API v4 calls the way an API token would be).
- First deploy attempt failed on Windows with `EPERM: symlink` during Next.js's standalone-output file tracing — fixed by the owner enabling Windows Developer Mode (grants regular users symlink-creation rights).
- Second deploy attempt succeeded but every route 500'd: `Dynamic require of "/.next/server/middleware-manifest.json" is not supported`. Confirmed via `wrangler tail` live logs, then confirmed via web research as a known `@opennextjs/cloudflare` + pnpm issue (Next's middleware-manifest loader falls back to a dynamic `require()` that the Workers ESM runtime can't execute). Fixed with `shamefully-hoist=true` + `node-linker=hoisted` in a new root `.npmrc` (the documented workaround for this specific pnpm-related bug), which required a full `node_modules` wipe across every workspace package (a partial root-only reinstall left stale symlinks and broke `next`'s own binary resolution — caught and fixed with a full clean before it reached production). Third deploy: all routes return 200, confirmed via curl.
- Live at: https://tradeflow-web.garychanjiayik.workers.dev

---

## Step History

### Step 11 — MT4/TMGM live-tick bridge + order-fill alerts — Status: code-complete, verified locally against a throwaway `supabase start` stack; NOT yet deployed. MQL4 EA and VPS runbook written but explicitly UNVERIFIED (no MetaEditor/MT4 terminal available in this environment)
*Date: 2026-09-15*

Trigger: owner trades XAUUSD on MT4 (broker TMGM) and wants the real broker price as
TradeFlow's primary source, plus a push notification when an order fills. Explored and
rejected this session before landing here: GoldAPI.io (built as Step 10, then reverted
— owner judged it unreliable), Forex.com's API (needs an actual account + multi-day
manual approval, same wall as OANDA/Capital.com/Deriv), TMGM's own free-VPS perk
(needs 7 lots/month or $3,000 deposit — owner meets neither). Landed on a DIY MQL4 EA
on OCI's free `VM.Standard.E2.1.Micro`. Planned via formal plan mode (one Plan-agent
research pass covering MQL4 specifics via WebSearch/WebFetch against mql4.com/
mql5.com — see the approved plan at
`C:\Users\jychan\.claude\plans\this-is-my-project-nifty-mist.md`), approved by owner,
then implemented directly in this session.

Files changed:
- `supabase/functions/_shared/processPriceAlerts.ts` (new) — `processPriceAlerts`
  extracted verbatim out of `tick-fast/index.ts` (including Step 6's
  confirm-write-before-push ordering), so both `tick-fast` and the new
  `mt4-webhook` share one evaluator instead of duplicating it.
- `supabase/functions/mt4-webhook/index.ts` (new) — TradeFlow's first *inbound*
  webhook (every prior function is pg_cron-triggered or a logged-in browser session).
  Auth via `x-webhook-secret` header against `MT4_WEBHOOK_SECRET`. Two payload types
  on one endpoint (`PRICE_TICK`, `ORDER_FILLED`) — one URL, not two, because MT4's
  `WebRequest()` allow-list is a manual GUI step per URL. `PRICE_TICK` runs the shared
  `processPriceAlerts` against the raw MT4 price (no `applyPriceBasis` — MT4/TMGM is
  already the real broker price that correction exists to approximate) and writes
  `last_price`/`last_price_at`/`mt4_last_seen_at`/`price_source='MT4'`. `ORDER_FILLED`
  sends a push notification (`pushToUserDevices`/`logNotification`, new event type)
  to a fixed `MT4_WEBHOOK_USER_ID`.
- `supabase/functions/tick-fast/index.ts` — new `isMt4Fresh` freshness gate (checks
  `instruments.mt4_last_seen_at` against `MT4_FRESHNESS_SECONDS`, default 25s):
  when MT4 is fresh, skips the Binance fetch, alert evaluation, AND the `last_price`
  write entirely (not just the write) before anything else runs — exactly one active
  evaluator at a time, chosen by freshness, so the same crossing is never evaluated
  against two different price streams in the same window. Binance's own write path
  gains `price_source: "BINANCE"`. Local `processPriceAlerts` function deleted;
  imports from `_shared/processPriceAlerts.ts` instead.
- `supabase/functions/_shared/notifications.ts` — `logNotification`'s `eventType`
  param widened from an inline `"PRICE_ALERT" | "GRAPH_REMINDER"` literal to the
  shared `NotificationEventType` (now three values).
- `supabase/migrations/0007_mt4_webhook.sql` (new) — `instruments` gains
  `mt4_last_seen_at timestamptz` and `price_source text check (...) default
  'BINANCE'`; `notification_log`'s `event_type` check constraint gains
  `'ORDER_FILLED'`. Documented rollback included.
- `supabase/config.toml` — new `[functions.mt4-webhook]` section, `verify_jwt =
  false` (the first `[functions.*]` section this repo has needed — every prior
  function is called with the service-role key as its bearer token, itself a valid
  project JWT; the MT4 EA has no such JWT to present, so without this every request
  would be rejected by the platform gateway before the function's own
  `x-webhook-secret` check ever runs).
- `packages/types/src/enums.ts` — `NotificationEventType` gains `"ORDER_FILLED"`;
  new `PriceSource = "MT4" | "BINANCE"`.
- `packages/types/src/instrument.ts` — `Instrument` gains `mt4_last_seen_at: string |
  null` and `price_source: PriceSource`.
- `mt4/TradeFlowMt4Bridge.mq4` (new, outside the repo's package structure) — MQL4 EA:
  `OnTimer` (every `InpHeartbeatSec`, default 5s) and throttled `OnTick` both push a
  price tick and run fill detection; fill detection does a full ticket/type rescan
  every poll (not incremental, to avoid a known `OrdersTotal()`-unchanged-between-
  two-real-changes blind spot) and tracks ticket -> last-seen `OrderType()`, since a
  pending order triggering keeps its ticket number (only the type changes) — a bare
  "is this ticket new" check would miss that. Every `WebRequest()` failure mode
  (network, timeout, `4060` = URL not allow-listed, non-200) is logged and swallowed,
  never fatal — the EA never places/modifies/closes trades itself, so a webhook
  outage has zero effect on actual trading.
- `mt4/README.md` (new) — VPS runbook: OCI provisioning, swap file, Wine/Xvfb
  install (scriptable), TMGM MT4 install + login + EA attach + WebRequest allow-list
  (manual/GUI-only, no scriptable path for any of these four), Supabase-side secret
  setup and deploy, and a verification checklist.

**Local verification performed (throwaway `supabase start` Docker stack, torn down
after — no real project touched):**
- `pnpm build`/`test`/`typecheck` at repo root — all green, no regressions (this step
  added no new package-level unit tests; `processPriceAlerts`'s move is mechanical
  and covered indirectly by the same integration checks below). `deno check` clean on
  `mt4-webhook/index.ts` and `tick-fast/index.ts`.
- `npx supabase db reset` applied `0001`-`0007` cleanly; confirmed via the local REST
  API that `instruments` gained `mt4_last_seen_at`/`price_source` (defaulting to
  `null`/`'BINANCE'` on existing rows).
- Created a local test user + a `price_alerts` row (target `4342`, `CROSS_UP`,
  `ONCE`) with `instruments.last_price` seeded to `4340`. Ran `mt4-webhook` for real
  (via a temporary, non-committed port-8321 copy of the file) with a live service-role
  client against the local stack:
  - Bad `x-webhook-secret` → `401 {"ok":false,"error":"unauthorized"}`.
  - Malformed `type` → `400 {"ok":false,"error":"malformed or unrecognized payload"}`.
  - Valid `PRICE_TICK` (`price: 4345`, crossing the seeded alert) → `200
    {"priceAlerts":{"evaluated":1,"triggered":1}}`; confirmed in the DB:
    `last_price=4345`, `price_source='MT4'`, `mt4_last_seen_at` set to the request
    time, the alert's `enabled` flipped to `false` (ONCE consumed) with
    `last_triggered_at` set, and a `notification_log` row
    (`event_type='PRICE_ALERT'`, `status='PENDING'` — no device registered, expected).
  - Valid `ORDER_FILLED` → `200`; confirmed a `notification_log` row with
    `event_type='ORDER_FILLED'` (proving `0007`'s constraint change actually accepts
    the new value, not just that the migration applied) and the correct message text.
- Ran `tick-fast` (temporary port-8322 copy) with `mt4_last_seen_at` set to "just
  now": confirmed it returned `{"priceAlerts":{"skipped":true,"reason":"MT4 is the
  fresh primary source..."}}` and made no Binance call. Re-ran with
  `mt4_last_seen_at` set to 27+ seconds in the past: confirmed it fell through to a
  real Binance fetch and `price_source` flipped back to `'BINANCE'` in the DB, while
  `mt4_last_seen_at` itself stayed untouched (confirming `tick-fast` never writes
  that field — `mt4-webhook` remains its sole writer).
- Deleted both temporary local-verify files before finishing; `git status` confirmed
  only the intended files changed (no stray `package.json` workspaces field or
  `deno.lock`, per KG-16).

**NOT verified (flagged explicitly, not glossed over):**
- `TradeFlowMt4Bridge.mq4` has never been compiled — no MetaEditor/MT4 terminal
  available in this environment. Written carefully from real MQL4/MQL5 community
  documentation (cited in the approved plan) but is a first draft, not proven-correct
  code. The owner must compile and soak-test it on the actual VPS per
  `mt4/README.md`'s verification checklist before trusting it for anything real.
- No real OCI VPS was provisioned, no real TMGM account was touched, and no real
  end-to-end fill notification has fired — all of `mt4/README.md`'s manual/GUI steps
  are unexercised.

Deploy: Supabase side is DEPLOYED (2026-09-16) — `0007_mt4_webhook.sql` applied via
the dashboard SQL Editor, `MT4_WEBHOOK_SECRET`/`MT4_WEBHOOK_USER_ID` secrets set,
`mt4-webhook` (confirmed `ACTIVE`, `verify_jwt: false` — the config.toml setting took
effect correctly) and `tick-fast` (confirmed `ACTIVE`) both redeployed via
`supabase functions deploy`. Real end-to-end behavior (a live TMGM tick actually
reaching the webhook) is still untested — that's gated on the VPS/EA below. The
VPS/EA side is entirely owner-executed per `mt4/README.md`.

### Update — 2026-09-16: OCI dropped, switched to GCP for the VPS

Owner tried to provision the OCI VPS as planned and hit a real regional gap, not a
capacity queue: `oci compute shape list` against the owner's actual tenancy in
`ap-kulai-2` (Malaysia West 2/Kulai — a brand-new OCI region) returned only
`BM.Standard.E5.192`, `BM.Standard3.64`, `VM.Standard.A1.Flex`, `VM.Standard3.Flex`,
`VM.Standard.E5.Flex`, `VM.Standard.A4.Flex` — every one either a paid shape or (for
`A1.Flex`) the wrong CPU architecture for reliable Wine. `VM.Standard.E2.1.Micro`
(the shape this step's design depended on) is not offered in this region at all;
Oracle's own docs still list it as Always Free tier-wide, but a new region can launch
without every legacy shape family's hardware deployed. This can't be waited out —
verified by asking OCI's own API directly, not by guessing from console UI behavior.

**Resolution: switched to GCP's `e2-micro`** (also genuinely Always Free, real
x86_64, no such regional gap — its only constraint is a fixed choice of three US
regions, `us-west1`/`us-central1`/`us-east1`, which doesn't matter for this
price-tick/fill-event use case). No TradeFlow code changed — the webhook design was
always provider-agnostic. Updated `mt4/README.md`'s provisioning section
(`gcloud compute instances create` instead of OCI's console/CLI steps, `pd-standard`
30GB boot disk to stay inside the free allowance, `gcloud compute scp`/`ssh` in place
of raw `scp`/`ssh`) — the rest of the runbook (Wine/Xvfb install, TMGM MT4 install,
EA compile/attach, WebRequest allow-list, Supabase secrets) is identical regardless
of cloud provider and was left unchanged.

### Known Gaps (added from Step 11)
- **KG-17** — `TradeFlowMt4Bridge.mq4` is unverified (see above) — the single
  biggest risk in this step. Not blocking the Supabase-side code (which is fully
  locally verified independent of the EA), but the feature delivers nothing real
  until the owner compiles, attaches, and soak-tests it.
- **KG-18** — No automated test coverage for `mt4-webhook`'s payload
  parsing/auth logic (no unit tests added — this project's Deno Edge Functions have
  none today, verified only via the `deno run`-against-a-local-stack pattern used
  throughout, consistent with how `tick`/`tick-fast` have always been verified).

---

### Step 10 (built, then reverted) — GoldAPI.io fallback for the price-basis calibration reference
*Date: 2026-09-14*

Built, unit/locally-verified, committed (`33b17b5`), and deployed to `tick` per the Step 10 entry that followed this one in history — see git history for the full original entry's content (`git show 33b17b5`). Owner then judged GoldAPI.io itself unreliable and asked to drop it and stick with chartgoldprice.com only. Reverted cleanly via `git revert 33b17b5` (commit `225a21a`) — removes `packages/market-data/src/goldApiProvider.ts` and its tests, restores `tick/index.ts`/`_shared/notifications.ts`/`packages/market-data/src/index.ts` to their Step 9 (chartgoldprice.com-only) state. Re-verified after revert: `pnpm build`/`test`/`typecheck` all green (market-data back to 25/25, `goldApiProvider.test.ts` gone), `deno check` clean on `tick/index.ts`.

Net effect: Step 9's calibration stands as originally shipped — chartgoldprice.com only, no fallback. When chartgoldprice.com is down/stale, `price_basis` simply doesn't update for that tick (same behavior as immediately after Step 9, before Step 10 existed) — this is accepted as-is per the owner's call, not treated as a gap to re-solve differently right now.

Also researched and rejected the same day: **Forex.com's REST API** (CIAPI/GCAPI, run by StoneX/GAIN Capital) as another possible calibration reference. It's a trading API for account holders, not a standalone price feed — access requires an actual Forex.com trading account plus emailing `support.en@forex.com` for an "AppKey," with ~3 business days' manual approval. No code was written for this (research-only, rejected before implementation). This is the same broker-account-signup wall already hit and abandoned for OANDA, Capital.com, and Deriv in the Step 2 revision (12 providers tried total) — owner chose not to repeat that path. If a future session considers a broker-style API again, check this note first; the pattern (multi-day manual approval gating a personal single-user app) has failed every time it's been tried in this project.

---

### Step 9 — Calibrate Binance PAXG price against chartgoldprice.com spot ("basis") — Status: code-complete, verified locally against a throwaway `supabase start` stack with real Binance + chartgoldprice.com network calls; NOT yet deployed/committed
*Date: 2026-09-14*

Trigger: owner reported TradeFlow's displayed/alerted XAUUSD price disagreeing with TradingView's. Root cause: `tick-fast` (Step 8) prices XAUUSD off Binance's PAXG/USDT ticker, a tokenized-gold proxy that trades at its own drifting premium/discount ("basis") to real spot gold — flagged but deliberately left uncorrected in the Step 2 revision ("no offset/calibration against OANDA... the PAXG-vs-spot basis isn't constant and there's no free live reference to calibrate against anyway"). `tick`'s existing Step 8 chartgoldprice accuracy check gave exactly that reference, just never applied it. Checked whether real OANDA credentials (a proper forex broker, closer to what TradingView shows) exist now instead — they don't; `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID` in `supabase/functions/.env.local` are still local-mock placeholders from Step 2's local verification.

Files changed:
- `packages/alert-engine/src/priceBasis.ts` (new) — pure, I/O-free `computePriceBasis(referencePrice, rawPrice)` (returns `{ rejected: false, basis, deltaPct }` or `{ rejected: true, reason, deltaPct }`; rejects if the implied delta exceeds a `MAX_BASIS_PCT = 5` sanity bound, so one bad/stale chartgoldprice reading can't swing the live alert price) and `applyPriceBasis(rawPrice, basis)` (`basis === null` → raw price unchanged, same null-baseline-skip shape as this project's other first-run branches).
- `packages/alert-engine/src/__tests__/priceBasis.test.ts` (new, 9 cases) — positive/negative/zero basis, right-at-bound accept, over-bound reject (both directions), null-basis passthrough, positive/negative basis application.
- `packages/alert-engine/src/index.ts` — added `export * from "./priceBasis"`.
- `packages/types/src/instrument.ts` — added `price_basis: number | null`, `price_basis_at: string | null` to `Instrument`, mirroring the new columns.
- `supabase/migrations/0006_price_basis.sql` (new) — `alter table instruments add column if not exists price_basis numeric, add column if not exists price_basis_at timestamptz`. Nullable, no default (mirrors `last_price`'s null-until-first-tick convention). Documented rollback (`drop column if exists` on both) — safe at any time since a missing/null basis just reverts to Step 8's raw-PAXG behavior.
- `supabase/functions/tick/index.ts` — `checkChartGoldPriceAccuracy` extended from read-only logging to also *write* the calibration: fetches a **fresh** raw Binance price (independent of `instruments.last_price`, which is itself basis-corrected as of this step and so is no longer a pure raw baseline) alongside chartgoldprice.com's quote, runs `computePriceBasis`, and on acceptance writes `instruments.price_basis`/`price_basis_at`. On rejection or either fetch failing: logs and skips, leaving the previous basis in place untouched. `tick` is now the sole writer of `price_basis`/`price_basis_at`, mirroring (never overlapping) `tick-fast`'s sole ownership of `last_price`/`last_price_at` — each function writes exactly one of the two field-pairs, never both.
- `supabase/functions/tick-fast/index.ts` — after fetching the raw Binance tick, computes `correctedPrice = applyPriceBasis(tick.price, instrument.price_basis)` and uses `correctedPrice` (not the raw tick) for both `processPriceAlerts` evaluation and the `instruments.last_price`/`last_price_at` write, so alerting and any future "current price" display stay consistent with each other. Added `summary.price = { raw, corrected, basis }` for observability. `processPriceAlerts` itself untouched.

**Local verification performed (throwaway `supabase start` Docker stack, torn down after — no real project touched):**
- `pnpm build`/`test`/`typecheck` at repo root — all green (new `priceBasis.test.ts`: 9/9; totals otherwise unchanged). `deno check` clean on both `tick/index.ts` and `tick-fast/index.ts`.
- `npx supabase db reset` applied `0001`-`0006` cleanly in order; confirmed via the local REST API that `instruments` gained `price_basis`/`price_basis_at`, both `null` on a fresh row.
- Ran `tick` for real against **live** chartgoldprice.com + Binance (via `deno run` against a temporary, non-committed port-8321 copy of the file — port 8000 was unavailable locally, held by an unrelated running project's Docker container, not touched). chartgoldprice.com's feed happened to be genuinely stale at test time (453 minutes old, a real external-outage condition, same class as KG-15) — this exercised the **reject/skip path for real**: logged and skipped, `price_basis` correctly left untouched rather than nulled out or corrupted.
- To exercise the **write path**, manually seeded `instruments.price_basis = 15.5` via the local REST API (simulating what `tick` writes on a successful calibration — the write itself uses the identical `update(...).eq("id", ...)` shape already proven live by `tick-fast`'s `last_price` write) and ran `tick-fast` for real against live Binance (raw price `4335.66`): response and DB both showed `last_price = 4351.16` (`4335.66 + 15.5`, exact), confirming `applyPriceBasis` is wired correctly end-to-end. Confirmed `price_basis`/`price_basis_at` were **not** touched by this `tick-fast` run (single-writer-per-field invariant holds).
- Deleted the two temporary local-only port-override copies before finishing; `git status` confirmed only the intended files changed (no stray `package.json` workspaces field or `deno.lock`, per KG-16).

Deploy: NOT deployed. `0006_price_basis.sql` is written and locally verified only — Arch applies it via the dashboard SQL Editor after review, same as prior migrations (KG-8). `tick` and `tick-fast` need `supabase functions deploy` for this step's changes to take effect once the migration is applied.

---

### Step 8 — Fast Binance-driven price-alert polling (10s), chartgoldprice demoted to accuracy check — Status: code-complete, verified locally against a throwaway `supabase start` stack with real Binance + chartgoldprice.com network calls, awaiting review; NOT yet deployed/committed
*Date: 2026-09-11*

Files changed:
- `supabase/functions/_shared/notifications.ts` (new, 134 lines) — extraction of `getRequiredEnv`, `configureWebPush`, `PushResult`, `pushToUserDevices`, `logNotification`, `describeProviderError` out of the pre-Step-8 `tick/index.ts`. `getRequiredEnv`, `configureWebPush`, `PushResult`, `pushToUserDevices`, and `logNotification` are byte-for-byte (only `export` added). `describeProviderError`'s doc comment was reworded ("the tick response summary" -> "a function's response summary", reflecting that it now serves two callers) — zero logic change, but not literally "only export keywords added" as originally reported; see Richard's Should Fix below.
- `supabase/functions/tick-fast/index.ts` (new, 182 lines) — new Edge Function: `new BinanceProvider().getPrice("XAUUSD")` directly (no fallback), `processPriceAlerts` moved verbatim (including Step 6's confirm-write-before-push ordering), unconditionally writes `instruments.last_price`/`last_price_at` on success. Never touches `graph_reminders`.
- `supabase/functions/tick/index.ts` (narrowed, 422 -> 218 lines, net -287/+83 vs. previous version) — removed `buildFallbackProvider`, `processPriceAlerts`, and the whole price-tick/`instruments`-write block; kept `timeStringToMinutes`, `buildReminderWindowArg` verbatim, and `processGraphReminders`'s logic (lines 79-132) verbatim, but its in-loop comment was reworded ("Same ordering requirement as processPriceAlerts: advance" -> "Same ordering requirement as processPriceAlerts (tick-fast): advance", reflecting that function's move to `tick-fast`) — zero behavioral difference, but not literally "verbatim" as originally reported; see Richard's Should Fix below. Added `checkChartGoldPriceAccuracy` (read-only, `console.log`s the successful-delta comparison, `console.error`s the skip/failure branch, feeds `summary.chartGoldPriceCheck`); imports switched to `_shared/notifications.ts`.
- `supabase/migrations/0005_tick_fast_cron.sql` (new, 77 lines) — `cron.schedule('tick-fast-every-10-seconds', '10 seconds', ...)`, reusing the existing `tick_function_service_role_key` Vault secret and introducing a new `tick_fast_function_url` one (documented, not created here). Documents that job id 1 (`tick-every-2-minutes`) needs no changes, plus a rollback `cron.unschedule(...)` line.
- `handoff/ARCHITECT-BRIEF.md` — added Builder Plan section (see file).

Decisions made:
- Followed the brief's two-Edge-Functions decision as specified — did not collapse `tick`/`tick-fast` into one file with a branching flag.
- `checkChartGoldPriceAccuracy`'s failure/skip branch (stale data, network error, missing baseline) originally used `console.log`, not `console.error`, matching the brief's explicit framing of this whole check as "routine observability, not a failure" — same reasoning extended from the success-path delta log to the skip path, since a flaky/stale chartgoldprice.com response is an anticipated, non-critical condition here (see KG-15), not an operational failure worth alerting on. **Richard's review found this reasoning didn't hold** — every other genuine-failure branch in this codebase (Binance fetch failures, `FallbackProviderError`, `processGraphReminders` write failures) uses `console.error` unconditionally regardless of whether the condition is "anticipated"; the pattern here has always been "provider/write failures get `console.error`, successful routine observability gets `console.log`," and this catch block was the one place that broke it. Fixed: the catch block's skip/failure log (line 185) now uses `console.error`. The success-path delta-comparison log (the one directly above it) correctly stays `console.log` — that one really is routine observability, not a failure.
- Delta computation is `chartGoldPrice.price - baselinePrice` (chartgoldprice minus Binance), not the reverse — arbitrary but documented in a code comment so the sign is unambiguous to a future reader.

**Local verification performed (throwaway `supabase start` Docker stack, `npx supabase` 2.117.0, torn down after — no real project touched):**
- `deno check` clean on `tick/index.ts`, `tick-fast/index.ts`, and `_shared/notifications.ts`.
- `pnpm build`, `pnpm test` (94 tests across 5 packages), `pnpm typecheck` at repo root — all green, confirming the no-op regression check (package internals unchanged).
- `npx supabase db reset` applied `0001`-`0005` cleanly in order, including `0005_tick_fast_cron.sql`. Confirmed via `docker exec ... psql -c "select jobid, jobname, schedule, active from cron.job"`: job 1 (`tick-every-2-minutes`, `*/2 * * * *`) unchanged, job 2 (`tick-fast-every-10-seconds`, schedule literally `10 seconds`, active) registered as a **separate** job — the brief's single riskiest unverified assumption confirmed for real, not by code review.
- Ran `tick-fast` for real (via `deno run` against the local stack's URL/service-role key — `supabase functions serve` was not retried given KG-5's prior finding on this same Windows+Docker setup for functions with relative imports outside `supabase/functions/`; went straight to the proven `deno run` workaround) against **live Binance** (PAXG/USDT, real network call, no mocking): seeded `instruments.last_price = 4000` and a `price_alerts` row (`target_price=4300`, `CROSS_UP`, `ONCE`) plus a due `graph_reminders` row for a real test user. First invocation: alert fired (`evaluated:1, triggered:1`), `instruments.last_price` updated to the real live price (`4354.44`), `last_triggered_at` set, `enabled` flipped to `false` (ONCE mode) — and `graph_reminders` was confirmed **byte-for-byte identical** before/after via a full-table diff. Second invocation confirmed `last_price_at` advances on every call (updated timestamp) even when the price value itself hadn't moved.
- Ran the narrowed `tick` for real (same `deno run` approach): the due `graph_reminders` row correctly advanced `next_trigger_at` to the next hourly boundary (`evaluated:1, triggered:1`), and — critically — `instruments` (`last_price`/`last_price_at`) was confirmed **byte-for-byte identical** before/after via a full-row diff, proving `tick` no longer writes that baseline.
- The live chartgoldprice.com feed happened to be genuinely stale at test time (`meta.updated_at` ~1165 minutes old — the same real-world condition already logged as KG-15), so the actual run exercised the `{ skipped: true, reason: "STALE_DATA: ..." }` branch end-to-end for real, not a mock. To also confirm the success-path delta log line is plausible, separately fetched chartgoldprice.com's raw current price (`4395.01`) and computed the same delta arithmetic against the real Binance baseline (`4354.44`) the two functions had just written: `delta=40.5700 (0.9317%)` — a sane, sub-1% real-spot-gold-vs-PAXG spread, confirming the arithmetic/format are correct for when the feed isn't stale.
- Torn down (`npx supabase stop`) after; no real project credentials or URLs used anywhere in this verification.

**Richard's review (2026-09-11, round 1) — Must Fix and Should Fix addressed:**

- **Must Fix — `supabase/functions/tick/index.ts:185`.** `checkChartGoldPriceAccuracy`'s catch block logged its skip/failure reason via `console.log`; changed to `console.error` to match every other failure branch's convention in this codebase (see corrected Decisions note above). One-line fix, no other logic touched. The success-path delta-comparison log directly above it is unchanged (`console.log`, correct as-is).
- **Should Fix (2, wording-only, no code change) — build report accuracy.** Richard diffed both "verbatim"/"byte-for-byte" claims against commit `136a76e` and found each had one reworded comment (zero logic difference): `processGraphReminders`'s in-loop comment (`tick/index.ts`) and `describeProviderError`'s doc comment (`_shared/notifications.ts`). Both corrected in this entry's Files Changed section above and in `handoff/REVIEW-REQUEST.md` — characterized as "logic verbatim, comment reworded" rather than pure byte-for-byte extraction.
- **Re-verification after the fix:** `pnpm build` (5/5), `pnpm test` (6/6, 94/94 tests unchanged), `pnpm typecheck` (8/8) at repo root — all green. `deno check --node-modules-dir=auto` clean on both `tick/index.ts` and `tick-fast/index.ts`. No other files touched.

Deploy: NOT deployed. Per the brief, `supabase db push` cannot run from this network (KG-8) — `0005_tick_fast_cron.sql` is written and locally verified only; Arch applies it via the dashboard SQL Editor after review, same as prior migrations. `tick-fast` also needs `supabase functions deploy tick-fast` and a `tick_fast_function_url` Vault secret created before its cron job can succeed against the real project.

---

### Step 7 — ChartGoldPriceProvider as primary XAUUSD source, Binance as automatic fallback — Status: code-complete, verified locally (mocked-fetch unit tests + a real live smoke-test call), awaiting review; NOT yet deployed to the live project
*Date: 2026-09-11. Background run per Arch's dispatch. Owner-researched replacement primary price source — see `handoff/ARCHITECT-BRIEF.md`'s Step 7 for full writeup (why chartgoldprice.com was chosen over three ruled-out alternatives, and why it's wired as primary-with-fallback rather than a hard swap). Builder Plan recorded in the brief's Builder Plan section before building; proceeded directly (background run) rather than waiting for a synchronous approval round-trip, matching the Step 5/6 precedent.*

**What was added:**

- **`packages/market-data/src/chartGoldPriceProvider.ts`** — new `ChartGoldPriceProvider`
  implementing `MarketDataProvider` against `GET https://www.chartgoldprice.com/api/data`,
  parsing `prices.gold.troy_ounce` as price. Mirrors `BinanceProvider`'s shape exactly
  (injectable `fetchFn`, typed `ChartGoldPriceProviderError` with a `code`, never
  returns/propagates `NaN`). Also parses `meta.updated_at` and throws a `STALE_DATA`
  error if it's more than 15 minutes older than "now" at call time (an injectable `now`
  config, defaulting to `() => new Date()`, makes this independently testable) — a
  missing/unparsable `updated_at` is treated the same way, not silently ignored.
- **`packages/market-data/src/fallbackProvider.ts`** — new `FallbackMarketDataProvider`
  implementing `MarketDataProvider`, constructed with an ordered
  `readonly MarketDataProvider[]`. `getPrice` tries each in order; on any thrown error,
  `console.error`s `"<ProviderName> failed: <reason>"` (using `provider.constructor.name`
  as the label, since `MarketDataProvider` is a bare interface with no name field of its
  own) and falls through to the next. Returns the first success completely untouched —
  the winning provider's own `PriceUpdate.provider` field is what identifies the actual
  source in the data. If every provider fails, throws a new `FallbackProviderError`
  (code `ALL_PROVIDERS_FAILED`) carrying every individual error in an `errors` array
  (same order as the provider list) and a message joining all of their `.message`s —
  nothing from an earlier failure is swallowed once a later one also fails.
- **`packages/market-data/src/index.ts`** — exports both new modules.
- **`packages/market-data/src/__tests__/chartGoldPriceProvider.test.ts`** (8 tests) and
  **`fallbackProvider.test.ts`** (3 tests) — mocked-`fetch` style matching
  `binanceProvider.test.ts`/`oandaProvider.test.ts` exactly. Covers: successful parse,
  HTTP error, missing/non-numeric `troy_ounce`, missing `updated_at`, stale `updated_at`
  (>15 min), and the 15-minute boundary itself (exactly 15 min old still accepted) for
  the new provider; primary-succeeds-fallback-never-called (asserted via
  `expect(secondary.getPrice).not.toHaveBeenCalled()`, not just the returned value),
  primary-fails-secondary-succeeds (asserts the failure was logged), and
  both-fail-aggregate-contains-both (asserts `.errors` holds both original `Error`
  instances and the message contains both) for the fallback wrapper.
- **`supabase/functions/tick/index.ts`** — `buildBinanceProvider()` replaced with
  `buildFallbackProvider()`, returning
  `new FallbackMarketDataProvider([new ChartGoldPriceProvider(), new BinanceProvider()])`.
  `BinanceProvider` itself: byte-for-byte unchanged, still the safety net, not replaced.
  The catch block's error-message formatting (previously a single
  `instanceof BinanceProviderError` check) is generalized into a new
  `describeProviderError` helper that also recognizes `ChartGoldPriceProviderError`, and
  a `FallbackProviderError` branch that unwraps `.errors` into the logged reason instead
  of collapsing an aggregate failure into an opaque top-level message. Top-of-file
  comments updated to describe the new primary/fallback behavior instead of only
  Binance.
- **`README.md`**'s COST/FREE TIER section — new `chartgoldprice.com` entry (same
  four-part format as the existing entries: free tier characteristics, what happens if
  it fails/degrades, potential paid cost, alternative) placed before the existing
  Binance entry; the Binance entry itself updated to describe its new role as automatic
  fallback rather than sole source.

**Builder-level decisions (flagged in the Builder Plan before building, not silently
decided):** the aggregate-error shape (`FallbackProviderError` with a `code` + `errors`
array, chosen over native `AggregateError` to match this codebase's existing
`<Provider>Error`-with-`code` convention); `provider.constructor.name` for the
fallback's log label (no interface change); `"CHARTGOLDPRICE"` as the new
`PriceUpdate.provider` value (matches the existing `"BINANCE"`/`"OANDA"` convention).

**Verification:**

- `pnpm --filter @tradeflow/market-data test` — 23/23 pass (up from 12: 6 existing
  Binance + 6 existing OANDA + 8 new ChartGoldPrice + 3 new Fallback).
- `pnpm build` / `pnpm test` / `pnpm typecheck` at repo root — all green, no
  regressions. Full workspace count: 92 tests across `@tradeflow/validation` (37),
  `@tradeflow/alert-engine` (32), `@tradeflow/market-data` (23); `web`'s Next.js
  production build compiles and typechecks; 8/8 packages typecheck clean.
- `deno check supabase/functions/tick/index.ts` (from `supabase/functions/`) — clean,
  no errors.
- **Live smoke test**: unlike Arch's local network (which cannot resolve
  `www.chartgoldprice.com` via corporate DNS — a confirmed local quirk, not a dead
  site, per the brief), this session's environment resolved and reached the real
  endpoint fine. `curl https://www.chartgoldprice.com/api/data` returned HTTP 200 with
  a body matching the brief's documented shape exactly —
  `meta.updated_at`/`prices.gold.troy_ounce` present and correctly typed, confirming
  the field names were not guessed and the provider's parsing logic is correct against
  a real response.
- **Real finding from the live smoke test, reported rather than worked around**: at
  the time of this smoke test (2026-09-11T00:46 UTC), the live response's
  `meta.updated_at` was `2026-09-10T10:29:16.944Z` — roughly 14 hours old, well past
  the 15-minute staleness threshold. This means `ChartGoldPriceProvider` would
  currently throw `STALE_DATA` in production right now and `FallbackMarketDataProvider`
  would fall through to Binance on every tick, until chartgoldprice.com's own feed
  updates again. This is not a bug in this step's code — it's a live illustration of
  exactly the risk the brief flagged (no named operator, no SLA, "refreshes on a
  schedule" with no documented interval guarantee) and exactly why the fallback exists.
  Flagged for Arch/owner awareness: once deployed, the tick function's response summary
  and Supabase logs should be checked post-deploy to see which provider is actually
  serving ticks in practice, since chartgoldprice.com may be staler than expected at
  least some of the time.

**Not yet deployed**: this step's changes (`supabase/functions/tick/index.ts` plus the
new `packages/market-data` files) are local-only, pending review — `supabase functions
deploy` needed after review clears, same gating as every prior step.

**Richard's review (2026-09-11) — Should Fix items addressed, both inline (under 5
minutes each, per BUILDER.md):**

- **`packages/market-data/src/chartGoldPriceProvider.ts:88,97`** — `this.fetchFn(url)`
  and `response.json()` are now each wrapped in their own `try/catch`. A thrown
  network-level error (e.g. DNS failure, connection reset) or a non-JSON response body
  now surfaces as a typed `ChartGoldPriceProviderError` with a new `NETWORK_ERROR` code
  (added to the `ChartGoldPriceProviderErrorCode` union) instead of an untyped error
  escaping — the original error's message is folded into the new error's message for
  debugging. The existing `HTTP_ERROR` check (`!response.ok`) sits untouched between the
  two new try/catch blocks. `FallbackMarketDataProvider`'s behavior is unchanged (it
  already caught untyped errors too), and `tick/index.ts`'s `describeProviderError`
  needed no change — it already branches on `instanceof ChartGoldPriceProviderError`
  and reads `.code`/`.message` generically, not on specific code values, so the new code
  is picked up automatically.
- **`packages/market-data/src/chartGoldPriceProvider.ts:130`** — the returned
  `PriceUpdate.timestamp` now uses `this.now().toISOString()` instead of
  `new Date().toISOString()`, consistent with the staleness check's use of the same
  injected clock. No behavior change in production (both were real wall-clock time
  either way); makes the `now` injection point fully deterministic for tests.
- **Tests added** (`packages/market-data/src/__tests__/chartGoldPriceProvider.test.ts`,
  now 10 tests, was 8): one asserting `NETWORK_ERROR` when `fetchFn` rejects, one
  asserting `NETWORK_ERROR` on a non-JSON response body. Strengthened the existing
  successful-parse test to assert `result.timestamp` equals the injected `now` exactly
  (`NOW.toISOString()`), not just "doesn't throw when parsed" — this is the concrete
  test the Should Fix note said "none of the current tests need" but is now trivial to
  assert given the fix.
- **Verification re-run after the fix**: `pnpm --filter @tradeflow/market-data test` —
  25/25 pass (up from 23). `pnpm build`/`pnpm test`/`pnpm typecheck` at repo root — all
  green, no regressions (94 tests total: 37 validation, 32 alert-engine, 25
  market-data; 8/8 packages typecheck; `web` production build compiles). `deno check
  tick/index.ts` — clean. No file outside `chartGoldPriceProvider.ts` and its test file
  needed changes — `describeProviderError` and `FallbackMarketDataProvider` already
  handle the new code generically, as expected.

### Step 6 — Reliability hardening: unchecked DB writes risk duplicate notifications — Status: code-complete, verified locally against a real forced-failure scenario, awaiting review; NOT yet deployed to the live project
*Date: 2026-09-02. Background run per Arch's dispatch. Reliability fix found during a deliberate hardening audit, not owner-reported — see `handoff/ARCHITECT-BRIEF.md`'s Step 6 for full writeup. Builder Plan recorded in the brief's Builder Plan section before building; proceeded directly (background run) rather than waiting for a synchronous approval round-trip, matching the Step 5 precedent.*

**What changed — `supabase/functions/tick/index.ts` only (no schema change, no new package, `evaluatePriceAlert`/`computeNextTriggerAt` untouched):**

- **`processPriceAlerts`** (the ONCE/CROSS duplicate-risk case): the `price_alerts`
  update that marks a crossing "handled" (`last_triggered_at`, and `enabled = false`
  for `ONCE`) now has its `{ error }` checked. On failure: `console.error` with the
  alert id and the Postgres error, then `continue` — skips both `pushToUserDevices`
  and `logNotification` for that alert entirely, leaving it in its pre-trigger state
  so the next tick's identical crossing is correctly retried instead of silently
  never being marked handled while a push already went out. On success: behavior is
  byte-for-byte identical to before (push, then log).
- **`processGraphReminders`** (the recurring-reminder duplicate-risk case): reordered
  so the `graph_reminders.next_trigger_at` update happens and is confirmed successful
  *before* `pushToUserDevices`/`logNotification`, not after. Same failure handling:
  `console.error` with the reminder id and error, `continue`, no push/log — the
  reminder stays "due" and is correctly retried next tick instead of firing a push
  now with no guarantee `next_trigger_at` actually advanced.
- **Three lower-severity unchecked writes** — added `{ error }` checks with
  `console.error` on failure, no new control flow (per the brief's explicit
  anti-over-engineering instruction — logging visibility was the actual gap, not a
  missing retry mechanism, for a single-user app with light load):
  `logNotification`'s `notification_log` insert, `pushToUserDevices`'s device-disable
  update (on a dead 404/410 push subscription), and the `instruments.last_price`/
  `last_price_at` update in the main handler.
- All five unchecked writes identified in the brief now have explicit error handling.
  No change to any evaluation logic (`evaluatePriceAlert`, `computeNextTriggerAt`
  calls, crossing detection, window arithmetic).

**Verification — genuine forced-failure scenario, not a read-through (per the brief's
explicit instruction that a "looks right" read is insufficient evidence here):**

Used the same throwaway local `supabase start` Docker stack pattern as Step 2/Step 5
(`npx supabase start` + `npx supabase db reset`, all four migrations 0001-0004 applied
cleanly). Ran the actual `tick/index.ts` entrypoint via `deno run` (not
`supabase functions serve` — same Windows/Docker file-mounting limitation Step 2
already found and documented; `deno run` exercises the identical source/import graph
without going through the CLI's dev-serve wrapper) against the local stack's real
Postgres+PostgREST, with throwaway VAPID keys (no real push delivery involved — 0
devices seeded, isolating the write-ordering fix from push-delivery mechanics, which
Step 2 already proved separately).

**Forcing mechanism**: `revoke update on public.price_alerts from service_role;` /
same for `public.graph_reminders` — a real Postgres permission-denied error (`42501`)
on the exact `UPDATE` statement the function issues, returned by `supabase-js` as
`{ error }` exactly like any other real write failure (constraint violation,
connection blip, etc.) would be, without needing to fabricate a row shape that
happens to violate a check constraint. Run directly via `docker exec ... psql` against
the local stack's `supabase_db_TradeFlow` container.

Seeded one auth user, the XAUUSD instrument with `last_price = 0.5`, one
`price_alerts` row (`target_price = 1, CROSS_UP, ONCE`) and one `graph_reminders` row
already due (`next_trigger_at` in the past). `target_price = 1` with `last_price`
seeded below it guarantees a real live Binance-fetched PAXG/USDT price (always well
above 1) deterministically satisfies the crossing condition on every invocation,
without depending on the exact live price value.

1. **Revoked** `UPDATE` on both `price_alerts` and `graph_reminders`. Invoked the
   function twice. Confirmed via the function's own stdout: both failures were
   logged with full detail —
   `Failed to mark price alert <id> as triggered, will retry next tick: { code: "42501", ..., message: "permission denied for table price_alerts" }`
   and the equivalent for `graph_reminders`. Queried the DB directly after both
   invocations: `price_alerts.enabled` still `true`, `last_triggered_at` still
   `null`; `graph_reminders.next_trigger_at` unchanged from its original due
   timestamp; `notification_log` — **0 rows**. Confirms (a) failure logged, (b) no
   push/notification_log happened for either event across two failed ticks, and the
   events remained in their pre-handled state rather than a push firing with the
   state write silently lost.
2. **Granted** `UPDATE` back on both tables, reset `instruments.last_price` to `0.5`
   again (it had advanced past the target on the first invocation via the
   still-unblocked `instruments` update, which would otherwise make the alert's
   crossing condition no longer true on a later tick — a seeding artifact of this
   test, not a bug), and invoked the function again. Confirmed via direct DB query:
   `price_alerts.enabled` flipped to `false`, `last_triggered_at` set to the
   invocation timestamp; `graph_reminders.next_trigger_at` advanced to the correct
   next 15-minute boundary; `notification_log` now has exactly one `PRICE_ALERT` row
   and exactly one `GRAPH_REMINDER` row (both `PENDING` — correct, since 0 devices
   were registered to push to). **No duplicate rows** despite the two earlier failed
   attempts. Confirms (c): the event was still evaluated and succeeded cleanly on a
   subsequent tick, with exactly one notification per event, not zero and not two.
3. **Lower-severity spot-check**: seeded a second, `EVERY_TIME`-mode alert (so it
   doesn't self-disable), reset `instruments.last_price` below target again, revoked
   `INSERT` on `notification_log`, invoked once more. Confirmed: the function
   returned its normal `200` JSON response (no crash), `console.error` logged
   `Failed to write notification_log row for user <id> (PRICE_ALERT): { code: "42501", ..., message: "permission denied for table notification_log" }`,
   and — critically, confirming this write is correctly non-blocking — the alert's
   own `price_alerts.last_triggered_at` **was** updated despite the log-insert
   failure, matching the brief's decision that this write's failure should be
   logged but not gate anything else. Did not separately force-fail the
   device-disable update or the `instruments` update — both follow the mechanically
   identical `{ error } = await ...; if (error) console.error(...)` pattern already
   proven correct by the notification_log spot-check and by `deno check`, and the
   brief's forced-failure requirement is specifically scoped to "the triggering
   write" (the two duplicate-risk cases), which received the full multi-invocation
   proof above.

Teardown: `grant`ed all revoked privileges back (hygiene on the throwaway stack),
`npx supabase stop`. `git status` confirms only `supabase/functions/tick/index.ts`
and `handoff/ARCHITECT-BRIEF.md` changed — no lingering scaffold or leftover files
from the local stack or the seed script (which lived entirely in the session
scratchpad directory, outside the repo).

**Also verified this session:**
- `deno check --config supabase/functions/deno.json supabase/functions/tick/index.ts`
  — clean (Deno 2.9.6).
- `pnpm build`, `pnpm test`, `pnpm typecheck` at repo root — all green, no
  regressions (this file is Deno-only and outside `pnpm`'s scope, but the brief's
  DoD asks to confirm nothing else broke). Test counts unchanged from Step 5: 32
  alert-engine, 37 validation, 12 market-data; 8/8 packages typecheck; `web`
  production build green (11 routes).

**Key decisions this session:**
- Chose privilege revocation (`REVOKE UPDATE/INSERT ... FROM service_role`) as the
  forcing mechanism, per the brief's "your call" — a real Postgres-level failure
  indistinguishable in shape from any other write failure the fix needs to handle
  (the code branches on "did `error` come back non-null," not on what caused it),
  cleaner to set up/tear down deterministically than engineering a constraint
  violation that would need a contrived row shape.
- Used `target_price = 1` (deterministically satisfied by any real live price) rather
  than trying to time the test against the live-fetched Binance price's exact value —
  keeps the test reproducible regardless of what PAXG/USDT is actually trading at
  when this is re-run.
- Did not force-fail all five unchecked-write sites individually — full
  multi-invocation proof for the two duplicate-risk reorder fixes (the brief's
  explicit ask), one representative spot-check for the lower-severity group (same
  code pattern, so one proof generalizes), matching the brief's own
  anti-over-engineering instruction rather than padding out repetitive test steps.

**Not yet done:** this step's `tick/index.ts` changes have not been redeployed to the
live Supabase project (`supabase functions deploy`) — pending review clearing, same
pattern as every prior step's deploy gating.

**Open questions for Arch:** none — the brief's Decisions left no ambiguity requiring
a judgment call beyond the forcing-mechanism choice, which is documented above for
awareness rather than as an open question.

**Blocked / Not Attempted:** none this step — full local Docker/Deno access
throughout, no live-project access needed (fix is code-only, no migration).

---

### Step 5 — Fix reminder timezone display bug + configurable market-open/close window — Status: code-complete, locally verified (DB layer via a throwaway local `supabase start` stack), Richard's Should Fix addressed, re-submitted for review; migration NOT yet applied to the live project
*Date: 2026-09-01. Background run per Arch's dispatch. Builder Plan recorded in `handoff/ARCHITECT-BRIEF.md`'s Builder Plan section before building, including two flagged deviations/additions from the brief's literal text (see below) — proceeded rather than blocking on a synchronous approval round-trip, per this session's instructions; both are called out again in `handoff/REVIEW-REQUEST.md` for Arch/Richard to weigh in on.*

**Display bug fix:**
- `apps/web/app/dashboard/reminders/page.tsx`'s `formatDate` now takes the reminder's own
  `timezone` and passes it as `toLocaleString`'s `timeZone` option (plus `dateStyle:
  "medium"`/`timeStyle: "short"`), instead of calling `toLocaleString()` with no timezone
  option (which rendered the raw UTC wall-clock time, since this Server Component runs on
  Cloudflare Workers whose runtime defaults to UTC). The *stored* `next_trigger_at` was
  always correct — only this display formatting was wrong. Exactly as specified in the
  brief's Decisions.

**`computeNextTriggerAt` window support (`packages/alert-engine/src/computeNextTriggerAt.ts`):**
- Added an optional 4th parameter, `window?: { startMinutes: number; endMinutes: number }`
  (plain numbers, no string parsing inside this function — per the brief's Flags, that
  conversion is the caller's job). The entire pre-existing no-window code path is left
  byte-for-byte untouched, gated behind `if (window) { ...; return ...; }` before it, so
  the original 9 tests are an exact, zero-risk regression proof.
- **Formula re-derivation** (flagged in the Builder Plan, worth restating here): I worked
  every one of the brief's three worked examples by hand before writing code. The
  offset formula (`offset = ((m - window.startMinutes) % 1440 + 1440) % 1440`) checks out
  exactly as the brief states. But the brief's suggested rollover-distance expression
  (`(windowLength - offset + 1440) % 1440`) does **not** reproduce the brief's own
  overnight-window example (`from=05:30`, window `22:00-06:00`, `offset=450`): that
  expression gives `30` (→ `06:00`, the window's own *end* — wrong), while `1440 - offset`
  gives `990` (→ `22:00`, matching the brief's stated expected answer). Used `1440 -
  offset` uniformly for both "rolled off the last in-window slot" and "currently outside
  the window" (they're the same formula) — verified against all three worked examples plus
  several additional boundary cases (exact window-end instant, well-before-window-opens,
  well-after-window-closes). See the doc comment above
  `minutesToNextPeriodicOccurrence` for the full reasoning.
- **1D-with-window**: implemented as `1440 - offset` against the anchor (`window.startMinutes`
  instead of `0`) rather than the brief's literal "same 'floor then always +1 day'
  structure" — the literal version would incorrectly skip *today's* still-upcoming
  occurrence whenever `startMinutes` is later in the day than `from`'s current time (e.g.
  anchor `10:00`, `from = 08:00` should give *today* `10:00`, not tomorrow). The formula
  used reduces algebraically to the existing (untouched) midnight-anchored behavior when
  `startMinutes = 0`, so the existing 1D regression tests double as an implicit
  correctness check of the generalization. No worked example was given for this branch in
  the brief — flagged for Arch's awareness in case a different behavior was actually
  intended.
- **Tests** (`packages/alert-engine/src/__tests__/computeNextTriggerAt.test.ts`): all three
  of the brief's worked examples pass as literal cases with matching expected values,
  plus: exact-window-end-instant exclusion, well-outside-window, an explicit `undefined`-window
  no-op check, both no-window regression cases (4H and 1D) re-asserted, three 1D-with-window
  cases (anchor still ahead, anchor already passed, from exactly at anchor), and one
  window case in a real IANA timezone (`Asia/Kuala_Lumpur`) to confirm the window logic
  composes correctly with the existing DST-safe wall-clock conversion rather than replacing
  it. 23 tests total in this file (was 9), all passing.

**Richard's review (2026-09-01) — Should Fix addressed:** the `Asia/Kuala_Lumpur` window
test above doesn't observe DST, unlike the pre-existing no-window suite's US DST
fall-back test — an asymmetry between the window and no-window suites' rigor. Added one
more test, mirroring the existing no-window DST test exactly (same transition, same
zone: US DST ends 2026-11-01 02:00 America/New_York, clocks fall back to 01:00) but with
an overnight `22:00-06:00` window and `1H` step applied. Hand-derived before writing the
assertion (see the test's own comment for the full derivation): `from =
2026-11-01T05:00:00Z` is wall-clock `01:00` local (EDT, pre-fallback), 180 minutes into
the window; the periodic-window arithmetic (pure minutes-of-day, no DST awareness needed
in that formula) advances 60 minutes to wall-clock `02:00` same calendar day; `02:00`
Nov 1 is unambiguous post-fallback EST (the repeated hour is `01:00-01:59`, not `02:00`),
so the final `zonedWallClockToUtc` conversion resolves it to `2026-11-01T07:00:00Z` — the
exact same target instant as the existing no-window DST test, which is what makes this
hand-verifiable rather than guessed. Test passes as expected, confirming Richard's
by-construction reasoning: the window helpers only ever operate on wall-clock
minutes-of-day already produced by `getWallClock`, and hand off to the same
`zonedWallClockToUtc` fixed-point conversion the no-window branches use unchanged — there
is no separate DST-sensitive code path in the window branch, so no bug was found and no
change to `computeNextTriggerAt.ts` was needed. 24 tests total in this file now (was 23).
`pnpm build`/`pnpm test`/`pnpm typecheck` re-run clean at repo root after this addition
(32 alert-engine, 37 validation, 12 market-data, all passing; 8/8 packages typecheck;
`web` production build green).

**Scope addition beyond the brief's literal text — `supabase/functions/tick/index.ts`:**
- Flagged in the Builder Plan as an escalation-worthy gap: the brief's Build Order and
  Definition of Done never mention this file, but `processGraphReminders` there also calls
  `computeNextTriggerAt` (to recompute `next_trigger_at` after each fire, every 2 minutes,
  live in production). Left unfixed, a windowed reminder's first occurrence (computed by
  the web app) would respect the window, but every occurrence after that (recomputed here)
  would silently revert to unrestricted/midnight-anchored behavior — breaking the feature
  within one tick cycle. Added `buildReminderWindowArg`/`timeStringToMinutes` helpers
  (mirroring `reminder-actions.ts`'s equivalent, duplicated rather than shared per the
  existing per-environment-helper convention already established for
  `getXauUsdInstrumentId`) and now passes the reminder's window through. Typechecked
  clean with `deno check index.ts` (Deno 2.9.6) — this file isn't covered by the Node
  `pnpm typecheck`/`pnpm test` since it's Deno-only.

**Migration (`supabase/migrations/0004_reminder_window.sql`, new, NOT applied to the live
project):**
- Adds `window_start_time time null` / `window_end_time time null` to `graph_reminders`,
  plus a `CHECK ((window_start_time IS NULL) = (window_end_time IS NULL))` constraint.
  Both nullable, default `NULL` — fully backward compatible, no backfill.
- **Cannot be applied via `supabase db push`** — this network blocks direct Postgres
  connections (KG-8, first hit by `0003_cron.sql`). Not attempted. Written for the repo's
  record only; Arch will apply the DDL via the Supabase dashboard SQL Editor after review
  clears, same as Step 2.
- **Verified LOCALLY only**, against a throwaway `supabase start` Docker stack (never the
  real project, no real project URL/credentials touched): `npx supabase db reset` applied
  all four migrations (`0001`-`0004`) cleanly in order; `\d public.graph_reminders`
  confirmed both new nullable `time` columns and the new CHECK constraint exist exactly as
  written; a direct SQL `INSERT` with only `window_start_time` set correctly raised
  `violates check constraint "graph_reminders_window_both_or_neither"`; a valid
  both-fields-set `INSERT` succeeded and round-tripped `06:00:00`/`22:00:00` correctly.
  Local stack torn down afterward (`npx supabase stop`) — no lingering containers, no
  files left behind (`git status` confirms only the intended source files changed).

**Validation (`packages/validation/src/graphReminder.ts`):**
- Added optional `window_start_time`/`window_end_time` (`"HH:MM"` strings) to both
  `createGraphReminderSchema` and `updateGraphReminderSchema` via a shared
  `withWindowFields` wrapper (avoids duplicating the both-or-neither/normalization logic
  across create and update).
- Zod `.refine()`: both present or both absent (mirrors the DB CHECK constraint —
  defense in depth, not reliance on the DB alone, per the brief).
- Zod `.transform()`: equal start/end times normalize to `null`/`null` before reaching the
  database, per the owner's framing ("6am to 6am the next day is equivalent to no set") —
  collapses what would otherwise be two valid-looking representations of "no restriction"
  into one. Also normalizes the omitted-both-fields case to explicit `null`/`null` (rather
  than leaving `undefined`), for the same "one representation" reasoning.
- **Tests** (`packages/validation/src/__tests__/graphReminder.test.ts`): both omitted,
  both explicitly null, both valid and distinct, an overnight-wrapping window, one-of-two
  set (both directions, rejected), malformed time string, out-of-range time string,
  equal-times-normalize-to-null, and the same both-or-neither rule on
  `updateGraphReminderSchema`. 28 tests total in this file (was 9), all passing.

**UI (`reminders/new/new-reminder-form.tsx`, `reminders/[id]/edit/edit-form.tsx`,
`reminder-actions.ts`):**
- Two optional `<input type="time">` fields ("Market open" / "Market close") added to
  both forms, with a short explanatory line. The edit form's defaults slice the DB's
  `"HH:MM:SS"` down to `"HH:MM"` (what `<input type="time">` requires).
- `reminder-actions.ts`: `readReminderFormFields` now reads the two window fields
  (empty string → `null`, same pattern already used for `description`). New
  `timeStringToMinutes`/`buildWindowArg` helpers convert validated `"HH:MM"` strings to
  the `computeNextTriggerAt` window arg. The existing `scheduleChanged` recompute guard
  (create/update actions) is extended to also compare the window fields — DB values
  (`"HH:MM:SS"`) are normalized to `"HH:MM"` first (`normalizeTimeForCompare`) before
  comparing, so an edit that doesn't touch the window doesn't spuriously look like a
  schedule change and trigger an unnecessary recompute.

**`packages/types/src/graphReminder.ts`:** added `window_start_time`/`window_end_time:
string | null` to the `GraphReminder` interface (DB `time` columns round-trip as
`"HH:MM:SS"` via PostgREST).

**Verified locally this session:**
- `pnpm build`, `pnpm test`, `pnpm typecheck` — all green at repo root. Test counts: 31
  alert-engine (was 8; +23 net across both files, see above), 37 validation (was 9; +28,
  see above), 12 market-data (unchanged). `web`'s production build compiles, typechecks,
  and generates all 11 routes.
- `deno check supabase/functions/tick/index.ts` — clean (Deno 2.9.6), confirming the
  window-arg wiring there typechecks against the Deno import graph too.
- Local `supabase start`/`db reset` Docker stack — see migration section above.

**Explicitly NOT verified this session (blocked pending Arch applying the migration —
per this session's instructions, no live verification against the real project for
anything needing the new columns):**
- No live create/edit of a windowed reminder against the real Supabase project — the
  live `graph_reminders` table does not yet have `window_start_time`/`window_end_time`,
  so any such attempt would fail with a PostgREST "column does not exist" error. Did not
  attempt this, and did not run the existing `reminder-crud.spec.ts` e2e spec against the
  live project either (it doesn't touch the new fields, so it would likely still pass, but
  running any live write against `apps/web/.env.local`'s real project felt like
  unnecessary risk while the schema is mid-migration — deferred to step 6 of the brief's
  Build Order, once Arch confirms the migration is live).
- The brief's Step 5 "Build Order" step 6 (live verification: create a windowed reminder,
  confirm `next_trigger_at` matches a hand-computed expectation, confirm the list page
  displays it correctly) is entirely pending Arch applying `0004_reminder_window.sql`.

**Open questions for Arch** (also see Builder Plan in `handoff/ARCHITECT-BRIEF.md`):
1. The 1D-with-window formula deviates from the brief's literal "always +1 day" wording
   (see above) — confirm the corrected behavior (today's occurrence when still ahead,
   tomorrow's when already passed) is what was actually intended.
2. The `tick/index.ts` scope addition (not in the brief's Build Order/Definition of Done)
   — confirm this was the right call rather than something to defer/handle separately.

---

### Step 4 — Fix: unauthenticated access to "new alert"/"new reminder" pages — Status: code-complete, live-verified, awaiting review
*Date: 2026-08-31. Background run per Arch's dispatch. Security/authorization fix, not a new feature — see `handoff/ARCHITECT-BRIEF.md`'s Step 4 for full root-cause writeup. Builder Plan recorded in `handoff/ARCHITECT-BRIEF.md`'s Builder Plan section before building.*

**What changed:**

- **Root cause confirmed by reading the code**: `apps/web/app/dashboard/alerts/new/page.tsx`
  and `apps/web/app/dashboard/reminders/new/page.tsx` were `"use client"` default-export
  page components with no server-side auth check — unlike every other page in the app
  (`dashboard/page.tsx`, both `[id]/edit/page.tsx` files), which are async server
  components that call `supabase.auth.getUser()` and `redirect("/login")` before
  rendering. This let an unauthenticated visitor receive a 200 with the full create-form
  HTML (confirmed live: Arch's brief cites the production `curl` result; this session
  reproduced it locally against a fresh `pnpm build` + `pnpm start` before the fix, then
  confirmed 307 after).
- **`apps/web/app/dashboard/alerts/new/new-alert-form.tsx`** (new file) — the exact
  former body of `alerts/new/page.tsx` (imports, `initialState`, `SubmitButton`, the
  form JSX), moved verbatim, default export renamed to a named export
  `NewAlertForm`. No logic, field, or behavior changes.
- **`apps/web/app/dashboard/alerts/new/page.tsx`** (rewritten) — now a plain async
  server component matching `alerts/[id]/edit/page.tsx`'s pattern exactly:
  `createClient()`, `getUser()`, `redirect("/login")` if no user, then renders
  `<NewAlertForm />` inside `<main>`. No record fetch (nothing to fetch for "new").
- **`apps/web/app/dashboard/reminders/new/new-reminder-form.tsx`** (new file) — same
  treatment for the reminder form, named export `NewReminderForm`. The
  browser-timezone-detection `useEffect` (defaults the timezone field to
  `Intl.DateTimeFormat().resolvedOptions().timeZone` after mount, to avoid a
  hydration mismatch) is preserved byte-for-byte.
- **`apps/web/app/dashboard/reminders/new/page.tsx`** (rewritten) — same
  server-guard pattern as the alert page, renders `<NewReminderForm />`.
- **Anti-pattern audit** (brief's build-order step 3): grepped `apps/web/app/**/page.tsx`
  for `^"use client"`. Before the fix: 4 hits (`alerts/new`, `reminders/new`,
  `login`, `signup`). After the fix: 2 hits remain — `app/login/page.tsx` and
  `app/signup/page.tsx`. Both are intentionally public, unauthenticated-by-design
  pages (that is their entire purpose — a logged-in-only login page would be
  nonsensical), so they are correctly excluded from this fix, not a missed instance.
  No other page in the app matches the anti-pattern.

**Verified live this session:**

- `pnpm build`, `pnpm typecheck`, `pnpm test` — all pass at repo root, no regressions
  (23 tests unchanged: 8 alert-engine + 6 market-data + 9 validation). Route output
  confirms both `/dashboard/alerts/new` and `/dashboard/reminders/new` now build as
  `ƒ` (dynamic, server-rendered) rather than the client-only shape they had before.
- **Unauthenticated redirect, local production build**: ran `pnpm start` (the real
  production build, using `apps/web/.env.local`'s real Supabase project — same env
  the build itself reported using) and `curl -i` both routes with no cookies.
  Before the fix this returned `200` with full form HTML; after the fix both return
  `307 Temporary Redirect` with `Location: /login`, byte-for-byte matching
  `/dashboard`'s existing unauthenticated behavior. Full response body on the 307
  is the standard Next.js redirect shell — no form field labels or any dashboard
  content present.
- **Authenticated create flows, real Supabase project**: ran the repo's existing
  Playwright e2e specs (`apps/web/e2e/alert-crud.spec.ts` and
  `reminder-crud.spec.ts`, both pre-existing from Step 3, not modified) against the
  live project — both pass. Each spec signs up a fresh real user, navigates via the
  "New alert"/"New reminder" link (i.e. through the now-server-guarded `page.tsx`),
  fills and submits the form, and confirms the created row appears, can be edited,
  and can be deleted. This confirms the split didn't break the authenticated path:
  the server guard correctly lets a real session through, and the client form
  component works identically to before.
- Did **not** attempt a live redeploy/curl against the production Cloudflare URL —
  this session has no `wrangler login`/deploy credentials (same constraint as prior
  steps); per "Pending deploy" above, Arch redeploys after review. Local
  `pnpm build`/`pnpm start` against the same `.env.local` config is the closest
  available proxy and is what the brief's Definition of Done asks to check "for real
  against the deployed app or a local build."

**Key decisions this session:**

- Followed the brief's prescribed fix pattern exactly (split into server `page.tsx` +
  sibling client form component, named to match the `edit-form.tsx` convention) —
  no deviation, no client-side auth check added to the form components (per the
  brief's explicit flag that this would be insufficient/wrong).
- Reused the existing Step-3 Playwright specs rather than writing new ones — they
  already exercise exactly the flow this fix needed to prove still works (navigate
  to the "new" page while authenticated, create, edit, delete), so a new spec would
  have been pure duplication for zero added coverage.

**Leftover test data**: this session's Playwright run created two more real test
users in the live cloud Supabase project (`e2e-<timestamp>@example.com`,
`e2e-reminder-<timestamp>@example.com`, per those specs' existing naming) — same
shape as KG-6/KG-9 below, harmless, `graph_reminders`/`price_alerts` rows were
deleted by the specs' own delete step, only the `auth.users` rows remain. No
service-role key available in this session to clean them up.

**Blocked / Not Attempted:** none — this step had no blockers; full live Supabase
access was available throughout.

---

### Step 3 — Graph/Chart Reminders UI (spec Feature B, Phase 16) — Status: code-complete, live-verified, awaiting review
*Date: 2026-08-31. Background run per Arch's dispatch — full live Supabase access, no blockers like Steps 1-2. Builder Plan recorded in `handoff/ARCHITECT-BRIEF.md`'s Builder Plan section before building.*

**What changed:**

- **Extracted `computeNextTriggerAt`** from `supabase/functions/tick/nextTrigger.ts` (Deno-only) to
  `packages/alert-engine/src/computeNextTriggerAt.ts` (new), exported from
  `packages/alert-engine/src/index.ts` alongside `evaluatePriceAlert`. Implementation and
  behavior are byte-for-byte unchanged — only the import of `ReminderTimeframe` was
  switched from a locally-redefined type to the shared one in `@tradeflow/types`
  (already a dependency of `alert-engine`, same as `evaluatePriceAlert` importing
  `PriceAlert` from there). `supabase/functions/tick/nextTrigger.ts` and
  `nextTrigger.test.ts` deleted — no duplicate left behind.
  `supabase/functions/tick/index.ts`'s import updated to
  `../../../packages/alert-engine/src/computeNextTriggerAt.ts`, the same relative-path
  pattern already used for `evaluatePriceAlert`.
- **Moved the 9 test cases** from `nextTrigger.test.ts` (bare `Deno.test` + manual
  asserts) to `packages/alert-engine/src/__tests__/computeNextTriggerAt.test.ts`
  (Vitest `describe`/`it`/`expect`), so they run in the same `pnpm test` suite as
  everything else. Same coverage: UTC/`+8`/DST-fall-back boundary cases across all
  four timeframes, plus the "always strictly future" invariant.
- **New `packages/validation/src/graphReminder.ts`**: `createGraphReminderSchema`/
  `updateGraphReminderSchema`, reusing `reminderTimeframeSchema` from `./enums.ts`
  (not redefined). `timezone` validated against
  `Intl.supportedValuesOf("timeZone")`, **plus an explicit `"UTC"` special case** —
  see "Platform quirk" below. `description` optional/nullable, capped at 500 chars
  (matching price alert's `message` cap, not separately specified in the brief).
  18 new tests in `packages/validation/src/__tests__/graphReminder.test.ts`: valid/
  invalid timeframe, valid/invalid IANA timezone (including the UTC case and a fake
  `GMT+8`-style non-IANA string), optional/null/empty/over-length description,
  create's `enabled` default vs. update's required `enabled`.
- **New `apps/web/app/dashboard/reminder-actions.ts`**: `createReminderAction`,
  `updateReminderAction`, `setReminderEnabledAction`, `deleteReminderAction` —
  structurally mirrors `actions.ts` (own local `getXauUsdInstrumentId` copy, not a
  shared util, matching how `actions.ts`/`device-actions.ts` are already independent
  files). Every query derives `user.id` from `supabase.auth.getUser()` and adds an
  explicit `.eq("user_id", user.id)` on top of RLS. `createReminderAction` computes
  `next_trigger_at` via `computeNextTriggerAt(timeframe, timezone, new Date())` before
  insert. `updateReminderAction` fetches the existing row's `timeframe`/`timezone`
  first and only recomputes `next_trigger_at` when either submitted value differs
  from what's stored — an edit that only changes `description`/`enabled` doesn't
  reset the schedule.
- **New UI pages**, mirroring `apps/web/app/dashboard/alerts/*`:
  `apps/web/app/dashboard/reminders/page.tsx` (list: Instrument/Timeframe/
  Description/Next occurrence/Status/Actions), `reminders/new/page.tsx` (create
  form), `reminders/[id]/edit/page.tsx` + `edit-form.tsx` (edit form). No instrument
  picker — fixed to XAUUSD, same as price alerts. The new-reminder form's timezone
  input defaults to the browser's detected zone via `Intl.DateTimeFormat().resolvedOptions().timeZone`,
  applied in a `useEffect` after mount (starts as an empty controlled value on both
  server and client render) to avoid an SSR/client hydration mismatch — still
  editable before submit.
- **Dashboard nav**: `apps/web/app/dashboard/page.tsx` gained a "Reminders" link in
  its `top-bar` actions row; `reminders/page.tsx`'s equivalent row links back to
  "Alerts". No new CSS, no shared nav component — each page just links to the other.
- **`apps/web/e2e/reminder-crud.spec.ts`** (new): sign up, create a reminder
  (timeframe + description), see it listed, edit the description, delete it —
  mirrors `alert-crud.spec.ts`'s structure.
- **`apps/web/package.json`**: added `@tradeflow/alert-engine: workspace:*` as a
  dependency (needed for `reminder-actions.ts`'s `computeNextTriggerAt` import; the
  web app previously only depended on `@tradeflow/types`/`@tradeflow/validation`).
  `pnpm install` re-run at root; `pnpm-lock.yaml` diff is 3 lines.

**Platform quirk found and resolved (not escalated — see rationale in Builder Plan):**
The brief's literal `Intl.supportedValuesOf("timeZone").includes(value)` check
rejects `"UTC"` — confirmed via a direct Node check (`Intl.supportedValuesOf("timeZone").includes("UTC")` → `false` on Node 24). This is an ECMA-402 enumeration gap
(`"UTC"` is a valid `Intl.DateTimeFormat` `timeZone` value; `Intl.supportedValuesOf`
just doesn't list the bare alias, only `Etc/UTC`-style canonical zones), not a bug in
this codebase — but it matters because `"UTC"` is `graph_reminders.timezone`'s own DB
default (`supabase/migrations/0001_init.sql`). Fixed by special-casing
`value === "UTC"` in addition to the `supportedValuesOf` check. Not treated as an
Escalate-to-Arch case per BUILDER.md ("brief ambiguous, wrong choice has downstream
consequences") — the correct behavior isn't a judgment call, just a documented gap in
one API's enumeration.

**Verified this session:**

- `pnpm build`, `pnpm test`, `pnpm typecheck` at repo root — all green. Test count:
  63 total (17 alert-engine [8 evaluatePriceAlert + 9 computeNextTriggerAt] + 27
  validation [9 device + 18 graphReminder] + 12 market-data + web's own
  type/lint/build checks pass with zero errors).
- `npx playwright test` (both `alert-crud.spec.ts` and the new
  `reminder-crud.spec.ts`) against the live Supabase project
  (`apps/web/.env.local`'s real `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`)
  — both pass. Confirms the actual server actions (not a reimplementation) work
  end-to-end through a real browser: sign up, create/edit/delete a reminder, RLS-
  scoped list correctly reflecting each change.
- **Direct live verification of `next_trigger_at` correctness** (one-off script,
  not part of the repo, run via `npx tsx` against the live project with the anon
  key — signs up its own throwaway user, not reused from the Playwright runs):
  confirmed a freshly-created reminder's `next_trigger_at` matches
  `computeNextTriggerAt(timeframe, timezone, now)` to the millisecond for a
  `1H`/`Asia/Kuala_Lumpur` create, confirmed it's recomputed correctly after
  changing both `timeframe` (→ `1D`) and `timezone` (→ `America/New_York`) on
  update, confirmed a second authenticated user cannot see the first user's
  reminder (RLS), and confirmed delete removes it. This is the DoD's "confirm
  `next_trigger_at` is set correctly on create and recomputed correctly when
  timeframe/timezone changes" item, checked directly against stored DB values
  rather than only inferred from UI behavior.
- `deno check` was **not** re-run against `supabase/functions/tick/index.ts` this
  session (this machine's network blocks Postgres ports, but Deno's own module
  resolution/typecheck doesn't need a DB connection — this was simply not repeated
  since the import swap is a pure relative-path change with no logic difference,
  identical in shape to the already-verified `evaluatePriceAlert` import). Flagging
  for Richard to spot-check if desired; low risk given the pattern is copy-exact.

**Key decisions this session:** see `handoff/ARCHITECT-BRIEF.md`'s Builder Plan
section (written before building, per BUILDER.md) for the full reasoning; summarized
here: (1) `computeNextTriggerAt` now imports `ReminderTimeframe` from `@tradeflow/types`
instead of redefining it locally, since it lives in a package that already depends on
`@tradeflow/types`; (2) `description` capped at 500 chars, matching price alert's
`message` field for consistency, not separately specified in the brief; (3) reminder
schedule (`next_trigger_at`) is only recomputed on update when `timeframe` or
`timezone` actually changed, not on every save.

**Blocked / Not Attempted:** none this step — full live Supabase access, no
network-port-block-sensitive operations needed (no new migration).

Architect notes (2026-08-30): Reviewed Bob's 6 open questions from REVIEW-REQUEST.md.
- Q2 (Cloudflare Workers vs. classic Pages) — APPROVED. OpenNext is the right call
  for an App Router app with server actions; noting explicitly for the record since
  it deploys under Cloudflare Workers, not Pages, contra the original brief wording.
- Q3 (`@opennextjs/cloudflare` pinned to 1.15.1) — APPROVED. Correct call; a Next
  14→15 upgrade is a real, separate decision, not something to back into via an
  adapter bump. Logged as a future consideration, not an action item now.
- Q5 (`supabase functions serve` Windows/Docker limitation) — Acknowledged, no
  action needed; production uses `supabase functions deploy`, a different path.
- Q1 (VAPID_SUBJECT email) and Q6 (leftover test users in the real Supabase
  project) — need the owner directly; raised with them alongside this step's
  review.
- Q4 (push handshake stubbed in sandbox) — Acknowledged as an environment
  limitation. Real delivery needs a genuine end-user device test once deployed;
  tracked as a pre-milestone-proof verification step, not a Step 2 blocker.

### Step 2 — Live price feed, cron worker, Web Push, deploy scaffolding — Status: code-complete, locally verified, awaiting review
*Date: 2026-08-30. This entry covers a continuation session: a prior Bob instance built `OANDAProvider` (+ tests), the `tick` Edge Function's core logic, and `supabase/functions/deno.json`, then was cut off before finishing local verification or logging anything here. This entry is written by the Bob instance that picked the work back up — it verifies and finishes Build Order items 2-8 from `handoff/ARCHITECT-BRIEF.md`.*

**Verified locally this session (`supabase functions serve` / `deno run`, Docker Desktop + local Supabase stack):**

- Ran `npx supabase@latest start` (local Docker stack — separate, throwaway, and unrelated to the Step 1 decision to develop `apps/web` against the real cloud project; this was purely for exercising the Edge Function against a real Postgres+RLS+service-role setup without needing the real project's service-role key, which this session never had access to). Migrations `0001_init.sql`/`0002_rls.sql`/`0003_cron.sql` all applied cleanly.
- **`supabase functions serve` Windows/Docker-Desktop limitation found and worked around:** the CLI's static file-mounting only bind-mounts files it finds via a literal relative-path import textually written in the entrypoint file, and does not reliably follow either import-map redirections or import chains more than one hop outside `supabase/functions/` — confirmed by iterating: it mounted `oandaProvider.ts` and `evaluatePriceAlert.ts` (both literal relative imports one hop from `tick/index.ts`) but repeatedly failed with `Module not found` for `packages/types/src/index.ts` (reached via the `@tradeflow/types` import-map specifier) and then `packages/types/src/enums.ts` (a further hop via `index.ts`'s own barrel re-export), each fix only surfacing the next missing file. This is a tooling/mounting bug, not a resolution bug: `deno check --config supabase/functions/deno.json supabase/functions/tick/index.ts` type-checks cleanly using the exact same import map and relative paths. **Verification method used instead:** ran the identical entrypoint directly via local Deno (`deno run --allow-net --allow-env --config supabase/functions/deno.json supabase/functions/tick/index.ts`), which starts the same `Deno.serve` HTTP listener without going through the Docker sandbox — same source files, same import map, same runtime semantics, just without the container's file-mounting step. Documenting this here per the brief's instruction to escalate rather than guess if the relative-path import approach didn't work cleanly: it *does* work cleanly at the Deno/TypeScript level; only the CLI's Windows dev-serve convenience wrapper has the gap. Recommend Arch/owner retest `supabase functions serve` directly with a newer CLI release or on a non-Windows host before relying on it for iteration; it is not required for either local verification or production (production uses `supabase functions deploy`, a different code path).
- **Seeded a real end-to-end scenario** (script-based, via `@supabase/supabase-js` against the local stack's admin API — not part of the repo): one test user, one `price_alerts` row (`target_price=2405, CROSS_UP, ONCE`), one `graph_reminders` row (`15m`, `next_trigger_at` already due). A tiny local HTTP mock stood in for OANDA's pricing endpoint via `TICK_LOCAL_VERIFY_MOCK_URL` (the scaffold the prior Bob left, documented below).
  - **Tick 1** (mock price 2400.20, below target): `instruments.last_price` seeded from `null` to `2400.2` with no price-alert evaluation (correct — first tick has no baseline to compare against). The due graph reminder correctly fired: a `PENDING` `notification_log` row inserted (no device registered, so nothing to push to — `PENDING` is correct per this file's own status-derivation logic, distinct from `FAILED`), and `next_trigger_at` advanced to the next real 15-minute boundary.
  - **Tick 2** (mock price 2410.00, crossing above 2405): the price alert correctly triggered — `enabled` flipped to `false` (`ONCE` mode), `last_triggered_at` set, a `PRICE_ALERT` `notification_log` row inserted with the correct "crossed 2405 upward" message, and `instruments.last_price` updated to `2410`.
  - **Tick 3** (a second alert + a device with a syntactically-valid-but-fake push subscription endpoint): confirmed the push-delivery error path — `webpush.sendNotification` failed against the fake endpoint, the function did not crash, `notification_log.status` was correctly recorded as `FAILED` (not `PENDING`, since a push *was* attempted), and the device stayed `enabled` (correct — only an actual 404/410 from the push service should disable a device, not a generic failure).
  - All three ticks exercised the real, imported `evaluatePriceAlert`/`computeNextTriggerAt`, not a reimplementation.
- **Removed the `TEMP-LOCAL-VERIFY` scaffold** from `supabase/functions/tick/index.ts`'s `buildOandaProvider()` (the `TICK_LOCAL_VERIFY_MOCK_URL` fetch-redirect block) now that it served its purpose — the shipped file talks to OANDA's real host unconditionally, per its own comment's instruction.
- **`0003_cron.sql` written and locally validated**: `create extension if not exists pg_cron/pg_net`, plus a `cron.schedule('tick-every-2-minutes', '*/2 * * * *', ...)` calling `net.http_post`. Secrets (the deployed function's URL and its service-role bearer token) are read from Supabase Vault (`vault.decrypted_secrets`) at execution time rather than inlined into the job body — `cron.job.command` is stored in plaintext and readable by anyone who can query `cron.job`, so hard-coding a service-role key there would be a credential leak inside both a git-tracked migration and the project's own catalog. `supabase_vault` is enabled by default on every Supabase project (confirmed present locally too). Validated locally via `supabase db reset` (clean apply, `cron.job` shows the schedule active) and a manual round-trip: created throwaway Vault secrets pointing at the local mock server and called `net.http_post` directly — got a real `200` response back through `pg_net`. **Not run against the real project** — `pg_cron`/`pg_net` enablement there is an owner/Arch-side dashboard action (see Blocked below), and the two real Vault secrets are deliberately not created by any tracked file (see the migration's own comments for the two `vault.create_secret` calls someone with real project access needs to run once, after the function is deployed).
- `pnpm build`, `pnpm test` (14 tests: 8 alert-engine + 6 market-data), `pnpm typecheck` — all pass at repo root.

**Verified live this session (real cloud Supabase project, no OANDA needed):**

- Web Push subscribe flow (`apps/web/public/sw.js`, `notifications-control.tsx`, `device-actions.ts`): a real signup, real service worker registration, and a real RLS-scoped `devices` insert were all confirmed via a Playwright-driven persistent (non-incognito) Chromium profile against the live project (`apps/web/.env.local`'s real `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`, plus a real locally-generated VAPID keypair). Confirmed by signing back in as the same test user with the anon key afterward and querying `devices` — RLS returned exactly the one row this session created, with the correct `platform`/`subscription` shape.
  - One browser-internal step was stubbed: the literal FCM/GCM push-service handshake inside `pushManager.subscribe()` hung / failed with "push service not available" in every configuration tried in this sandboxed execution environment (default ephemeral Playwright context: blocked outright — Chrome deliberately disables the Push API in incognito-like contexts, "no way to feature-detect this" per Chrome's own console warning; a real persistent Chrome profile, headless and headed: "push service not available", i.e. no reachable path to Google's push infrastructure from this sandbox). This is a Chrome↔Google-infrastructure dependency outside this app's code, not a defect — verified by everything else in the flow working correctly, including the exact server action that runs after `subscribe()` resolves. Recommend a real end-user browser test (or a CI runner with genuine internet egress) before fully trusting live push *delivery* end-to-end; the *subscribe-and-persist* path is fully verified.
  - Leftover test data: this verification created a handful of `push-verify-*@example.com` test users (and one `devices` row each) in the **real** cloud Supabase project — this session has no service-role key for that project, so it could not clean them up via script. Harmless (no real user data), but flagging for the owner/Arch to delete via the Supabase dashboard if desired.

**Key decisions this session:**

- **`@opennextjs/cloudflare` pinned to `1.15.1` exactly (not the latest `^1.20.x`)** — the previous Bob's plan (see `handoff/ARCHITECT-BRIEF.md` Builder Plan) correctly chose OpenNext over the legacy `@cloudflare/next-on-pages`, but the latest published version now requires Next.js `>=15.5.24` and has fully dropped Next 14 support (confirmed via `npm view` across the version history — support was dropped starting the `1.16.x` line; `1.15.x` is the last line whose peer range, `^14.2.35 || ~15.x || ^16.x`, includes our pinned Next `14.2.35`). Installing latest without checking this would have either produced an unmet-peer-dependency warning silently ignored or, worse, someone "fixing" it later by bumping Next to 15 as an unplanned, unreviewed breaking change (Next 15 makes `cookies()`/`headers()` async, which touches every server action and Server Component in `apps/web`). Pinned exactly (no `^`) so a routine `pnpm update` can't silently jump majors again. Upgrading to Next 15 to unlock newer OpenNext releases is a real future decision, not made here.
- **Did not wire `initOpenNextCloudflareForDev()` into `next.config.mjs`**, despite it being OpenNext's documented recommended setup step. It changes local-dev behavior for every contributor (sets up Cloudflare binding emulation) and there is no Cloudflare account to validate it against yet; the deploy-readiness bar per the brief is correct build config, not full Cloudflare dev-parity. `wrangler.jsonc` + `open-next.config.ts` + the `cf:preview`/`cf:deploy` scripts are in place and sufficient for that bar. Flagging as a deliberate scope call, easy to add later.
- Cloudflare scripts named `cf:preview`/`cf:deploy` (not `preview`/`deploy`/overriding `build`) specifically to leave the plain `next build` behind `pnpm build` untouched — that's the command the rest of the monorepo's Turborepo pipeline and this step's own verification depend on.
- `devices` upsert (`apps/web/app/dashboard/device-actions.ts`) is an **application-level** upsert (select-then-update-or-insert on `subscription->>endpoint`), not a DB-level `ON CONFLICT` — there's no unique constraint on `devices.subscription`, and adding one for a single JSONB path was judged more schema churn than this step needs. A user re-subscribing (cleared browser data, or a device previously disabled after a 404/410) re-enables and refreshes the existing row instead of accumulating duplicate device rows.
- A strict-mode TypeScript/lib.dom mismatch surfaced during `pnpm build`: `Uint8Array`'s generic default (`ArrayBufferLike`, which includes `SharedArrayBuffer`) doesn't structurally satisfy `BufferSource` (`ArrayBufferView<ArrayBuffer>`) under the current DOM lib typings, even though the actual runtime value is always a plain `ArrayBuffer`. Fixed with a narrow `as BufferSource` cast at the one call site (`notifications-control.tsx`), commented with why — a real type-only mismatch, not a runtime bug.
- A `supabase/functions/deno.lock` file appeared as a byproduct of running `deno check`/`deno run` this session (pins the exact resolved versions of the `npm:` specifiers `@supabase/supabase-js`/`web-push` and their transitive deps). Kept and tracked — this is Deno's standard lockfile mechanism, directly analogous to `pnpm-lock.yaml`, and pinning these versions is exactly the kind of reproducibility this repo already values elsewhere.

**Blocked / Not Attempted (owner/Arch-side, per the brief's flags):**

- No real `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID` exist — the owner's practice-account signup is still blocked per `handoff/ARCHITECT-BRIEF.md`'s Step 2 preamble. Nothing in `OANDAProvider` or the tick function is stubbed to compensate; they will work unmodified once real credentials are dropped into Edge Function secrets.
- `supabase functions deploy` was not run — the project isn't linked in this session (would need `supabase login` + `supabase link --project-ref pepizbjtpclypgfzkole`, an owner/Arch-side credential action), and the brief explicitly defers this to the owner.
- `pg_cron`/`pg_net` extension enablement on the **real** project, and the two `vault.create_secret` calls `0003_cron.sql` depends on, were not run against the real project — dashboard/SQL-editor access this session doesn't have. Validated the migration and the whole vault+pg_net mechanism locally instead (see above).
- No `wrangler deploy`/`wrangler login` was run — no confirmed Cloudflare account this session, per the brief's flag.
- `VAPID_SUBJECT`'s real `mailto:` contact address is still an open question — see `handoff/REVIEW-REQUEST.md`.

**Review Fixes (2026-08-30, Richard's Step 2 round-1 review):**
- **Must Fix (security — SSRF)** — `packages/validation/src/device.ts`'s `webPushSubscriptionSchema` accepted `endpoint: z.string().url()`, any scheme/host. Since `endpoint` is stored in `devices.subscription` and fed straight into `webpush.sendNotification` by `supabase/functions/tick/index.ts` (invoked by pg_cron every 2 minutes with server-side network access), this was a real SSRF primitive reachable by any authenticated user via the server action directly. Fixed with defense in depth via a new `pushEndpointSchema` (`z.string().url().superRefine(...)`): parses the URL and rejects anything whose `protocol` isn't exactly `https:`, then rejects any hostname not in an allowlist of known Web Push service hosts — exact match for `fcm.googleapis.com` (Chrome/Android), `updates.push.services.mozilla.com` (Firefox), `web.push.apple.com` (Safari), and a suffix match (`.endsWith(".notify.windows.com")`) for Edge/Windows WNS endpoints, which vary their subdomain per registration. Added `packages/validation/src/__tests__/device.test.ts` (new test file; also added `vitest`/`vitest.config.ts`/a `test` script to `packages/validation/package.json`, matching the `alert-engine`/`market-data` pattern — this package had no test infra before) — 9 cases: a valid https endpoint for each of the four allowlisted hosts, a plain http endpoint on an otherwise-valid host (rejected), a non-allowlisted https host (rejected — the actual SSRF case, `https://internal.example.com/`), a malformed URL (rejected), a `file:` scheme (rejected), and a host that merely contains an allowlisted hostname as a substring/prefix of a longer attacker-controlled domain (rejected — confirms the check is a real hostname match, not a string-contains check).
- **Should Fix** — `apps/web/app/dashboard/page.tsx`'s alerts-listing query had no `.eq("user_id", user.id)`, the same defense-in-depth gap already fixed once on `edit/page.tsx` in Step 1. Added the filter.
- **Documentation gap** — `handoff/REVIEW-REQUEST.md`'s Files Changed table was missing `supabase/config.toml` and `supabase/.gitignore` (both `supabase init` scaffolding, already reviewed clean by Richard). Added both with a one-line description each.
- Verified after fix: `pnpm install` (links `vitest` into the new `packages/validation` test setup), `pnpm build`, `pnpm test` (now 23 tests: 8 alert-engine + 6 market-data + 9 validation, all pass), `pnpm typecheck` — all green, repo root.

### Step 2 (revision) — Swap active price feed from OANDA to Binance PAXG — Status: code-complete, locally verified, awaiting review
*Date: 2026-08-31. Pre-deployment correction to Step 2 (not a new step, not renumbered) — see `handoff/ARCHITECT-BRIEF.md`'s Step 2 revision for the full reasoning: the owner's OANDA practice-account signup, and two alternative broker demo APIs (Capital.com, Deriv), all failed for reasons outside our control after trying 12 providers total. The owner decided to use Binance's public PAXG/USDT ticker as V1's XAUUSD source instead, with no offset/calibration against OANDA — deliberately rejected, since the PAXG-vs-spot basis isn't constant and there's no free live OANDA reference to calibrate against anyway.*

**What changed:**

- **New `BinanceProvider`** (`packages/market-data/src/binanceProvider.ts`): implements `MarketDataProvider` against Binance's public `GET https://data-api.binance.vision/api/v3/ticker/price?symbol=PAXGUSDT` — no API key, secret, or env var of any kind, confirmed reachable with a live `curl` call during this session (`{"symbol":"PAXGUSDT","price":"4423.32000000"}`). Maps `XAUUSD` -> `PAXGUSDT` internally, same one-mapping-per-symbol pattern `OANDAProvider` already used. Parses the `price` string field to a number and throws a typed `BinanceProviderError` (`UNKNOWN_INSTRUMENT` / `HTTP_ERROR` / `INVALID_PRICE`) rather than ever returning/propagating `NaN` — mirrors `OANDAProviderError`'s pattern exactly. New `packages/market-data/src/__tests__/binanceProvider.test.ts` (6 cases, mocked `fetch`): successful parse, HTTP error status, missing `price` field, non-numeric `price` field, unknown instrument (no `fetch` call made), and a no-config-argument construction path (confirms it can default to the global `fetch`, since this provider — unlike OANDA's — takes no required config).
- **`OANDAProvider` untouched, kept in the codebase** (`packages/market-data/src/oandaProvider.ts` + its own test file) — not wired into anything active, not deleted, per the brief's explicit flag. It remains the concrete example of the provider-swap the `MarketDataProvider` abstraction exists for.
- **`packages/market-data/src/index.ts`**: added `export * from "./binanceProvider"` alongside the existing OANDA/provider exports.
- **`supabase/functions/tick/index.ts`**: `buildOandaProvider()` (which read `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID`/`OANDA_ENV`) replaced with `buildBinanceProvider()` (no env reads at all — Binance's public endpoint is keyless); the one call site, the `catch` block's error-type check (`OANDAProviderError` -> `BinanceProviderError`), and file-header/inline comments mentioning OANDA were updated to Binance. Alert evaluation, push sending, and reminder handling are byte-for-byte unchanged — confirmed via `git diff`, only the provider-related lines differ.
- **`supabase/functions/.env.local.example`**: removed the `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID`/`OANDA_ENV` placeholder block, replaced with a comment explaining no price-feed credentials are needed on the active path and where `OANDAProvider` still lives if ever wired back in. Web-Push-related entries (`VAPID_*`) untouched.
- **`apps/web/.env.local.example`**: no changes — inspected and confirmed it never had OANDA entries to begin with (only Supabase/VAPID keys), so the brief's instruction to remove OANDA placeholders there was a no-op. (Correction, see "Review fix" below: this file was in fact modified during this session — a stray Finnhub block was added by mistake and the review-request claim above was wrong. It has since been reverted; the statement above now reflects the file's actual, correct end state.)
- **`README.md`**: Status section now describes the active feed as Binance PAXG/USDT (with a pointer to the Step 2 revision for why); Structure section's `market-data`/`functions/tick` one-liners updated; COST/FREE TIER section's OANDA entry replaced with a Binance entry (free/keyless, per-IP rate limit, what happens if exceeded, alternative-provider note) plus a new short OANDA entry documenting it as a built-and-reviewed-but-unwired future option.
- **`docs/SETUP.md`**: removed the "fill in fake OANDA credentials" step and the `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID`/`OANDA_ENV` line from the `deno run` local-verification example (Binance needs none); added a short note on where `OANDAProvider` exists and what re-wiring it later would involve, without implying it's required setup.

**Verified this session:**

- `pnpm build`, `pnpm test`, `pnpm typecheck` at repo root — all green. Test count: 29 total (8 alert-engine + 9 validation + 12 market-data — 6 Binance + 6 OANDA, both suites still passing since OANDA's own file/tests were untouched).
- `deno check --config supabase/functions/deno.json supabase/functions/tick/index.ts` — clean, no type errors, confirming the Deno-side import swap resolves correctly (this file isn't covered by the pnpm-workspace `typecheck` task since it's Deno, not Node).
- `curl -s "https://data-api.binance.vision/api/v3/ticker/price?symbol=PAXGUSDT"` — live call during this session returned `{"symbol":"PAXGUSDT","price":"4423.32000000"}`, reconfirming Arch's earlier finding that the endpoint needs no auth and is currently up.
- Grepped the repo (excluding `node_modules`) for `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID`/`OANDA_ENV`: the only remaining hits are in `docs/SETUP.md` (the intentional "how to wire OANDA back in later" note) and historical handoff docs (`handoff/ARCHITECT-BRIEF.md`, this file, `handoff/SESSION-CHECKPOINT.md`) — none in any active code path, `oandaProvider.ts`/its test file are of course excluded as expected keepers.

**Key decisions this session:**

- Kept `buildBinanceProvider()` as a one-line wrapper function (rather than inlining `new BinanceProvider()` at the call site) to preserve the existing `buildOandaProvider()`-shaped structure and keep a natural place for the comment explaining why no config/env is needed — minimizes the diff's shape versus the reviewed original.
- `BinanceProviderConfig` has no required fields (unlike `OANDAProviderConfig`'s `apiToken`/`accountId`/`environment`) since the endpoint is genuinely keyless; `fetchFn` is still injectable for tests, defaulting to the global `fetch`.
- Did not touch `supabase/functions/.env.local` (the untracked, gitignored local secrets file some earlier session created) — it may still contain stale OANDA placeholder values, but nothing reads them anymore and it's not a tracked file the brief asked to update.

**Blocked / Not Attempted:** none new — this revision only touches already-reviewed Step 2 surface area. The pre-existing Step 2 blockers (function deploy, pg_cron/pg_net enablement on the live project, Cloudflare deploy) are unchanged and listed in Current Status above.

**Review fix (2026-08-31):** Richard's review of this revision found one Must Fix —
`apps/web/.env.local.example` had in fact gained two unrelated lines (a
`FINNHUB_API_KEY` placeholder and its comment) that were never part of this
task's scope and aren't referenced anywhere in the codebase, and the Files
Changed table above wrongly claimed "no change" for that file. Fix applied:
removed the two Finnhub lines, restoring the file to be byte-for-byte
identical to its pre-revision content (`git diff` now shows no diff at all
for this file), and corrected the Files Changed table in
`handoff/REVIEW-REQUEST.md` by dropping the `apps/web/.env.local.example` row
entirely, since it no longer differs from `HEAD`. Re-ran `pnpm build`,
`pnpm test`, `pnpm typecheck` at repo root — all still green (29 tests), as
expected for an env-example-only revert.

### Step 1 — Repo scaffold, schema, auth, alert CRUD, alert-engine core — Status: BLOCKED (partial — see below)
*Date: 2026-08-30*

Files changed: see `handoff/REVIEW-REQUEST.md` for the full file list with rationale.

Decisions made:
- Package manager pinned via `packageManager: pnpm@9.12.3` in root `package.json`; Next.js 14.2.x (App Router, not 15) chosen specifically so `next/headers` `cookies()` stays synchronous, matching the standard `@supabase/ssr` server-client pattern.
- Internal cross-package relative imports use extensionless specifiers (`./enums`, not `./enums.js`) — `moduleResolution: "Bundler"` in `tsconfig.base.json` allows this, and it was required to make Next.js's webpack bundler resolve `@tradeflow/*` workspace packages consumed as raw TS source (via `transpilePackages`) rather than pre-compiled `dist/` output. Originally written with `.js` extensions per common ESM-NodeNext convention; switched after `pnpm build` failed with "Module not found" errors in `apps/web`.
- Added a `handle_new_user` trigger on `auth.users` (in `0001_init.sql`) to auto-create the matching `profiles` row on signup. Not explicitly requested in the brief, but without it the `profiles` table (which the brief does specify) would never be populated by anything — this is plumbing to make the specified schema functional, not a new feature.
- `docs/SETUP.md` instructs turning off Supabase's "Confirm email" setting for local/e2e use, because `apps/web/e2e/alert-crud.spec.ts` logs in immediately after signup and cannot do so if email confirmation is required first.
- Server actions (not client-side fetch + API routes) used for all alert CRUD and auth flows, using React 18's `useFormState`/`useFormStatus` from `react-dom` — standard Next.js 14 App Router pattern, keeps the UI functional without additional client-side data-fetching libraries.
- No Database-generated TypeScript types from Supabase CLI (`supabase gen types typescript`) — that requires a live project to introspect, which does not exist yet. Query results are typed manually via `.returns<T>()` casts against `@tradeflow/types` interfaces instead. Should be replaced with generated types once the project exists (Step 2 or later).

Architect notes (2026-08-30): Reviewed Bob's open questions from REVIEW-REQUEST.md.
- Open Question 1 (PROJECT_SPEC.txt provenance) — RESOLVED. Replaced the reconstructed
  file with the owner's actual verbatim spec text (had it from the planning conversation).
  KG-3 is closed.
- Open Questions 2-5 (handle_new_user trigger, no generated Database type yet,
  extensionless workspace-package imports, unpinned-by-brief dependency versions) —
  APPROVED as built. All are sound, low-risk technical calls within normal Builder
  discretion; no changes requested.

Reviewer findings (2026-08-30, Richard's first pass): 1 Must Fix, 1 Should Fix — both addressed same day, see "Review Fixes" below.
Deploy: N/A — not deployed anywhere yet.

**Review Fixes (2026-08-30):**
- **Must Fix** — `apps/web/app/dashboard/alerts/[id]/edit/page.tsx` fetched the alert-to-edit by `.eq("id", params.id)` only, relying on RLS alone to stop cross-user access. Added `.eq("user_id", user.id)` to the select, matching the app-side defense-in-depth pattern already used by every other `price_alerts` query in `apps/web/app/dashboard/actions.ts`.
- **Should Fix** — `apps/web/app/dashboard/actions.ts` (`readAlertFormFields`) called `new Date(expirationRaw).toISOString()` before zod validation ran, so an unparseable date string threw an uncaught `RangeError` (raw 500) instead of a friendly validation error. Now checks `Number.isNaN(parsed.getTime())` first (same check `expirationMustBeFuture`'s refine already does); if invalid, the raw string is passed through so `updatePriceAlertSchema`/`createPriceAlertSchema`'s refine rejects it cleanly.
- Verified after fix: `pnpm build`, `pnpm test` (8/8 alert-engine tests pass), `pnpm typecheck` — all green, repo root.

**What was verified locally (no live Supabase project required):**
- `pnpm install` — succeeds, 6 workspace packages linked.
- `pnpm build` — succeeds for all 5 buildable packages (`@tradeflow/types`, `@tradeflow/validation`, `@tradeflow/market-data`, `@tradeflow/alert-engine`, `web`). `web`'s Next.js production build compiles, typechecks, and generates all 9 routes successfully with placeholder env values absent (no `.env.local` exists — Next.js does not require env vars to exist at build time here since they're only read at request time in Server Components/Actions).
- `pnpm test` — all 8 required `evaluatePriceAlert` cases pass (see `packages/alert-engine/src/__tests__/evaluatePriceAlert.test.ts`), named to match the brief's wording verbatim.
- `pnpm typecheck` — clean across all 5 TypeScript packages, strict mode on.
- `npx playwright test --list` (from `apps/web`) — confirms `e2e/alert-crud.spec.ts` parses correctly and registers 1 test, without needing browsers installed or a live server.

**What is BLOCKED pending the owner creating the Supabase project (per the brief's known flag):**
- `pnpm --filter web dev` has not been run against real auth — no `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` exist. No `.env.local` was created; only `apps/web/.env.local.example` with obviously-fake placeholder values.
- The full manual walkthrough (sign up, log in, create/edit/enable/disable/delete an XAUUSD alert) has not been performed.
- The Playwright e2e test (`pnpm test:e2e` in `apps/web`) has not actually been run end-to-end — only confirmed it lists/parses correctly.
- RLS has not been verified manually with two live test users against a real project. The two migrations (`0001_init.sql`, `0002_rls.sql`) were written and reviewed by inspection (every user-owned table has `auth.uid() = user_id`/`id` policies for select/insert/update/delete as applicable; `instruments` has select-only for `authenticated`, no client write policy). Once a project exists, this should be verified by: creating two users A and B via signup, each creating a price_alert, then confirming (a) user A's `select` on `price_alerts` returns only their own row, (b) user A cannot `update`/`delete` user B's row (should return 0 rows affected / a permission-denied-shaped empty result, not an error that leaks existence), and (c) both users can `select` from `instruments`.
- Migrations have not been applied to any live project (there isn't one yet).

Once the owner hands over the Supabase project URL and anon key, the remaining Definition of Done items (live `dev` boot, manual CRUD walkthrough, live RLS check with two users, live Playwright run) can be completed without further code changes — nothing in the codebase is stubbed or fake beyond the missing env values.

---

## Known Gaps
*Logged here instead of fixed. Addressed in a future step.*

- ~~KG-1~~ RESOLVED 2026-08-30 — Owner created the Supabase project, placed the URL/anon key in `apps/web/.env.local`, and confirmed via `docs/SETUP.md` that the full local walkthrough (dev boot, alert CRUD, etc.) works as expected. Step 1's Definition of Done is now fully met.
- **KG-2** — No Supabase-generated `Database` type (`supabase gen types typescript`) exists yet; Supabase query results are typed via manual `.returns<T>()` casts against `@tradeflow/types` instead. Should be regenerated from the real schema once the project exists. — logged 2026-08-30
- **KG-3** — `PROJECT_SPEC.txt` is a reconstruction from `handoff/ARCHITECT-BRIEF.md`, not a verified verbatim copy of an original spec document (none was available this session). See open question in `handoff/REVIEW-REQUEST.md`. — logged 2026-08-30
- **KG-4** — `turbo run build` emits `WARNING no output files found for task ...#build` for the 4 `tsc --noEmit`-only packages (types/validation/market-data/alert-engine), because their `build` script never emits files but `turbo.json`'s shared `outputs` config expects `dist/**`. Cosmetic only — build still succeeds and exits 0 — not fixed to avoid scope creep into per-package turbo task configs this step. — logged 2026-08-30
- **KG-5** — `supabase functions serve` does not work reliably on this Windows + Docker Desktop setup for a function with relative imports reaching more than one hop outside `supabase/functions/` (see Step 2 entry above for the full diagnosis). Worked around for this session's verification via direct `deno run`; not fixed in the tooling itself since it's outside this repo's control. Retest with a newer Supabase CLI release before assuming it's still broken. — logged 2026-08-30
- **KG-6** — A handful of `push-verify-*@example.com` test users (each with one `devices` row) were created in the **real** cloud Supabase project while verifying the Web Push subscribe flow live (see Step 2 entry). Harmless test data, not cleaned up — this session has no service-role key for that project. Owner/Arch can delete them from the Supabase Auth dashboard if desired. — logged 2026-08-30
- **KG-7** — `VAPID_SUBJECT`'s real `mailto:` contact address is undecided; a placeholder (`mailto:fake-placeholder@example.com` / `mailto:placeholder@example.com`) is used in `.env.local.example` files and was used for local testing. See open question in `handoff/REVIEW-REQUEST.md`. — logged 2026-08-30
- **KG-9** — A handful more test users (`e2e-reminder-*@example.com`, `verify-reminder-*@example.com`) were created in the **real** cloud Supabase project while running Step 3's Playwright e2e tests and a one-off live-verification script (see Step 3 entry above). Same shape as KG-6: harmless, no real user data, not cleaned up (no service-role key in this session). The `graph_reminders`/`devices` rows those tests created were deleted by the tests themselves (delete is part of the CRUD flow being tested); only the `auth.users` rows remain. Owner/Arch can delete via the Supabase Auth dashboard if desired. — logged 2026-08-31
- **KG-10** — Two more test users (`e2e-<timestamp>@example.com`, `e2e-reminder-<timestamp>@example.com`) were created in the **real** cloud Supabase project while re-running the existing Step 3 Playwright specs to verify Step 4's fix. Same shape as KG-6/KG-9: harmless, `price_alerts`/`graph_reminders` rows self-deleted by the specs, only `auth.users` rows remain, no service-role key in this session to clean up. Owner/Arch can delete via the Supabase Auth dashboard. — logged 2026-08-31
- **KG-11** — Step 4's fix is not yet live on the production Cloudflare deployment (see "Pending deploy" above) — this session had no `wrangler deploy` credentials. Until Arch redeploys, `https://tradeflow-web.garychanjiayik.workers.dev/dashboard/alerts/new` and `/dashboard/reminders/new` remain unauthenticated-accessible in production, same as when Arch's brief found them. Fix is code-complete and verified against a local production build; only the deploy step remains, same constraint as Step 3's UI. — logged 2026-08-31
- **KG-12** — Step 5's migration (`supabase/migrations/0004_reminder_window.sql`, adding `window_start_time`/`window_end_time` to `graph_reminders`) is written but **not applied** to the live Supabase project — same `supabase db push` network block as KG-8. Verified only against a throwaway local `supabase start`/`db reset` Docker stack (torn down after; no real project touched). Until Arch applies this DDL via the dashboard SQL Editor: (a) the live `graph_reminders` table has no window columns, so creating/editing a reminder with a market-open/close window set would fail with a PostgREST "column does not exist" error against production, and (b) Step 5's Build Order step 6 (live verification of the windowed schedule + display fix) cannot be performed. The display-only bug fix (`reminders/page.tsx`'s `formatDate` timezone fix) does not depend on this migration and could be deployed/verified independently if desired. — logged 2026-09-01
- **KG-15** — Step 7's live smoke test (2026-09-11T00:46 UTC) found chartgoldprice.com's
  real response currently `meta.updated_at`-stale by this step's own 15-minute
  threshold (~14 hours old at test time), meaning `ChartGoldPriceProvider` would throw
  `STALE_DATA` on every tick right now and `FallbackMarketDataProvider` would fall
  through to Binance every time, not just occasionally. Not a code defect — this is the
  exact risk the Step 7 brief flagged (no named operator/SLA) — but worth confirming
  post-deploy which provider is actually serving ticks in practice via the tick
  function's Supabase logs/response summary, in case chartgoldprice.com turns out to be
  stale more often than the brief's research suggested. — logged 2026-09-11

---

## Architecture Decisions
*Locked decisions that cannot be changed without breaking the system.*

- Monorepo: Turborepo + pnpm workspaces; `apps/web` (Next.js App Router) + `packages/{types,validation,market-data,alert-engine}` — 2026-08-30
- `packages/alert-engine`'s `evaluatePriceAlert` is pure and I/O-free; all "don't fire again" state (ONCE mode) is expressed via caller-supplied `last_triggered_at`, never mutated by the engine — 2026-08-30
- `instruments.last_price` / `last_price_at` are the only "previous price" storage for V1 — no separate price-ticks history table — 2026-08-30
- Supabase `auth.users` is the sole identity source of truth; the app never defines its own `users` table — 2026-08-30
- `evaluatePriceAlert` and `OANDAProvider` are imported into the Deno `tick` Edge Function by relative filesystem path (never duplicated inline) — the deployed cron logic and the tested/reviewed Node logic are always the exact same source — 2026-08-30
- pg_cron/pg_net secrets (the deployed function's URL and its service-role bearer token) live in Supabase Vault, read at cron-execution time via `vault.decrypted_secrets` — never inlined into a migration file or `cron.job.command` — 2026-08-30
- `@opennextjs/cloudflare` is pinned to the exact last version supporting Next.js 14 (`1.15.1`) — do not bump past the `1.15.x` line without also deciding to upgrade Next to 15, a separate decision — 2026-08-30
- `computeNextTriggerAt` (like `evaluatePriceAlert`) lives in `packages/alert-engine`, is pure/I/O-free, and is imported by both the web app (`@tradeflow/alert-engine` workspace specifier) and the Deno `tick` Edge Function (relative filesystem path) — one implementation, never duplicated — 2026-08-31
