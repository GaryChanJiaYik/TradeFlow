# TradeFlow

Price alerts and trading reminders for XAUUSD (gold), built as a Turborepo
monorepo. See `PROJECT_SPEC.txt` for the full product spec and
`handoff/ARCHITECT-BRIEF.md` for the current build step's decisions.

## Status

**Step 2** — live OANDA price feed, the pg_cron-invoked "tick" Edge
Function, Web Push notifications, and Cloudflare deploy scaffolding. See
`handoff/BUILD-LOG.md` for exactly what's verified vs. still blocked on
owner/Arch-side setup (a real OANDA token, function deploy, pg_cron/pg_net
extension enablement, and an actual Cloudflare deploy).

## Structure

```
apps/
  web/                 Next.js app (auth, dashboard, alert CRUD, push subscribe)
packages/
  types/               Shared TypeScript types
  validation/          zod schemas mirroring DB constraints
  market-data/         MarketDataProvider interface + OANDAProvider implementation
  alert-engine/        Pure evaluatePriceAlert() + its Vitest suite
supabase/
  migrations/          SQL migrations (schema + RLS + pg_cron schedule)
  functions/tick/      Edge Function: OANDA price -> alert/reminder evaluation -> Web Push
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

**OANDA (price feed):**
- Free tier includes: a practice/demo v20 REST API account is entirely
  free, with no card required — this is what V1 uses exclusively
  (`OANDA_ENV=practice`; no "live" trading-account code path exists). OANDA
  does not publish a hard rate limit for the practice API, but the "tick"
  Edge Function only calls it once per cron invocation (every 2 minutes ==
  30 requests/hour), far below any plausible throttling threshold.
- What happens if exceeded: if OANDA ever rate-limits or the practice
  account lapses, `OANDAProvider.getPrice` throws a typed
  `OANDAProviderError` (see `packages/market-data/src/oandaProvider.ts`);
  the tick function catches it, logs the failure in its response summary,
  and skips only that tick's price-alert evaluation — it does not crash,
  and graph reminders (which don't need a price) still run that tick.
- Potential paid cost: none at V1's scale — a real trading (live) account
  is a different, unused product tier and is never touched by this app.
- Alternative: any other FX/metals price API with a free tier (e.g.
  Twelve Data, Alpha Vantage) could replace `OANDAProvider` behind the
  existing `MarketDataProvider` interface without touching the alert-engine
  or the Edge Function's evaluation logic.

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
