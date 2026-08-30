# TradeFlow

Price alerts and trading reminders for XAUUSD (gold), built as a Turborepo
monorepo. See `PROJECT_SPEC.txt` for the full product spec and
`handoff/ARCHITECT-BRIEF.md` for the current build step's decisions.

## Status

**Step 1** — repo scaffold, schema, auth, alert CRUD, and the alert-engine
core. No live price feed, cron, or push notifications yet (Step 2).

## Structure

```
apps/
  web/                 Next.js app (auth, dashboard, alert CRUD)
packages/
  types/               Shared TypeScript types
  validation/          zod schemas mirroring DB constraints
  market-data/         MarketDataProvider interface (no implementation yet)
  alert-engine/        Pure evaluatePriceAlert() + its Vitest suite
supabase/
  migrations/          SQL migrations (schema + RLS)
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

**OANDA (price feed) and hosting:** not wired up yet. Cost/free-tier notes
for these will be added here in Step 2 once they're introduced.
