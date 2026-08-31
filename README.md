# TradeFlow

Price alerts and trading reminders for XAUUSD (gold), built as a Turborepo
monorepo. See `PROJECT_SPEC.txt` for the full product spec and
`handoff/ARCHITECT-BRIEF.md` for the current build step's decisions.

## Status

**Step 2** — live Binance PAXG/USDT price feed (V1's XAUUSD source; see the
Step 2 revision in `handoff/ARCHITECT-BRIEF.md` for why OANDA was swapped
out pre-deployment), the pg_cron-invoked "tick" Edge Function, Web Push
notifications, and Cloudflare deploy scaffolding. See `handoff/BUILD-LOG.md`
for exactly what's verified vs. still blocked on owner/Arch-side setup
(function deploy, pg_cron/pg_net extension enablement, and an actual
Cloudflare deploy).

## Structure

```
apps/
  web/                 Next.js app (auth, dashboard, alert CRUD, push subscribe)
packages/
  types/               Shared TypeScript types
  validation/          zod schemas mirroring DB constraints
  market-data/         MarketDataProvider interface + BinanceProvider (active) / OANDAProvider (kept for later)
  alert-engine/        Pure evaluatePriceAlert() + its Vitest suite
supabase/
  migrations/          SQL migrations (schema + RLS + pg_cron schedule)
  functions/tick/      Edge Function: Binance price -> alert/reminder evaluation -> Web Push
docs/
  SETUP.md             Local setup instructions
```

## Requirements

- Node.js >= 18.18
- pnpm (via corepack — see `packageManager` in `package.json`)
- A Supabase project (see `docs/SETUP.md`)

## Getting started

```
pnpm install
pnpm build
pnpm test
```

To run the web app locally you also need a Supabase project and its
URL/anon key — see `docs/SETUP.md`.

## COST / FREE TIER

*Figures below are as of this writing (2026) — verify against
https://supabase.com/pricing before relying on them for a real launch, as
free-tier terms can change.*

**Supabase (Postgres + Auth):**
- Free tier includes: 500 MB database space, 50,000 monthly active users,
  5 GB egress/month, social/email auth, and the project pauses automatically
  after 7 days of inactivity (it can be un-paused from the dashboard, but
  data is not deleted).
- What happens if exceeded: database writes are blocked once storage is
  full; auth/API requests are rate-limited or rejected once egress or MAU
  limits are hit for the billing period. Supabase does not silently delete
  data.
- Alternative if the free tier becomes insufficient: upgrade to the
  Supabase Pro plan (usage-based pricing beyond the included quotas), or
  self-host Supabase (Postgres + GoTrue) on a low-cost VPS. Neither is
  needed at V1's expected scale.

**Binance (price feed — active in V1):**
- Free tier includes: `data-api.binance.vision`'s public ticker endpoint
  (`GET /api/v3/ticker/price?symbol=PAXGUSDT`) is entirely free, keyless,
  and requires no signup or account at all. V1 uses PAXG/USDT (a
  gold-backed crypto token, not literally spot gold — see
  `handoff/ARCHITECT-BRIEF.md`'s Step 2 revision for the accepted tradeoff
  and why OANDA/Capital.com/Deriv were tried and ruled out first) as its
  XAUUSD price source. Binance rate-limits this endpoint per IP, but does
  not publish a fixed number for it; the "tick" Edge Function only calls it
  once per cron invocation (every 2 minutes == 30 requests/hour), far below
  any plausible throttling threshold for a single instrument.
- What happens if exceeded: if Binance ever rate-limits or the endpoint
  returns an error, `BinanceProvider.getPrice` throws a typed
  `BinanceProviderError` (see `packages/market-data/src/binanceProvider.ts`);
  the tick function catches it, logs the failure in its response summary,
  and skips only that tick's price-alert evaluation — it does not crash,
  and graph reminders (which don't need a price) still run that tick.
- Potential paid cost: none — this is a public data mirror with no paid
  tier to fall into.
- Alternative: swap `BinanceProvider` for another `MarketDataProvider`
  implementation (e.g. `OANDAProvider`, already built and reviewed but kept
  unwired — see below — or another FX/metals price API with a free tier)
  without touching the alert-engine or the Edge Function's evaluation
  logic, if Binance's public endpoint ever stops being free/reliable enough.

**OANDA (price feed — documented future option, not currently wired in):**
- `packages/market-data/src/oandaProvider.ts` implements `MarketDataProvider`
  against OANDA's v20 practice REST API and is fully built, tested, and
  reviewed, but is not called from `supabase/functions/tick/index.ts` — it
  was swapped out pre-deployment for `BinanceProvider` (see the Step 2
  revision in `handoff/ARCHITECT-BRIEF.md`) after the owner's OANDA practice
  signup, and two alternative brokers, all failed for reasons outside our
  control. Kept in the codebase as the concrete example of a future
  provider swap, not dead code — see `docs/SETUP.md` for how to wire it
  back in if a real OANDA (or similar) account ever becomes available.

**Cloudflare (hosting — Workers via the OpenNext adapter, not classic
Pages; see `handoff/REVIEW-REQUEST.md` for why):**
- Free tier includes: 100,000 requests/day on Cloudflare's Workers Free
  plan, 10ms of CPU time per request, and no bandwidth charge for static
  assets served from the Workers Assets binding (`.open-next/assets`).
  Comfortably covers V1's expected traffic (a handful of users' dashboards).
- What happens if exceeded: requests beyond the daily free-tier cap are
  rejected (HTTP 1015-style rate-limit response) until the daily quota
  resets, or the account is prompted to upgrade — Cloudflare does not
  silently bill on the Free plan.
- Potential paid cost: the Workers Paid plan is $5/month (includes 10
  million requests/month, then usage-based beyond that) if V1 ever outgrows
  the free daily request cap.
- Alternative: Vercel's free hobby tier (the "native" host for Next.js) is
  the most direct swap if Cloudflare's Workers-not-Pages distinction (see
  the open question in `handoff/REVIEW-REQUEST.md`) turns out to be
  unwanted; the app has no Cloudflare-specific code paths beyond
  `apps/web/wrangler.jsonc` and `open-next.config.ts`, so switching hosts
  does not touch application logic.
