# Session Checkpoint — 2026-08-31

---

## Where We Stopped

**Milestone 1 is proven.** The spec's primary success criterion — create an XAUUSD
alert, laptop off, cloud detects a real crossing, phone receives a push notification
— is confirmed working end-to-end in production. Full verification (server-side
`price_alerts`/`notification_log`/`instruments` state, plus the owner's own phone)
is logged in `handoff/BUILD-LOG.md`'s "Milestone 1 Proof" section.

Everything is deployed and live:
- Web app: https://tradeflow-web.garychanjiayik.workers.dev (Cloudflare Workers)
- `tick` Edge Function: deployed, scheduled via pg_cron every 2 minutes
- Code: pushed to https://github.com/GaryChanJiaYik/TradeFlow (branch `main`)

Per the spec's own instruction (section 29): "If YES: the architecture is proven."
The next conversation should NOT restart infrastructure work — it should move to
V1's remaining features (Feature B: graph reminders has schema but no UI yet) or
begin V2 per the roadmap, unless the owner directs otherwise.

---

## What Was Decided This Session

- (Carried from before) Binance PAXG/USDT as the XAUUSD source, no offset applied.
- Owner's network blocks direct Postgres ports (5432/6543) — confirmed via raw TCP
  tests. `supabase db push`/`migration list` cannot run from this machine; future
  migrations need the Supabase dashboard SQL Editor instead (HTTPS-based, unaffected).
- Cloudflare deploy required `shamefully-hoist=true` + `node-linker=hoisted` in a new
  root `.npmrc` — a documented fix for a pnpm + `@opennextjs/cloudflare` middleware-
  manifest bug (dynamic `require()` unsupported in the Workers ESM runtime). Confirmed
  via live `wrangler tail` logs and a matching upstream GitHub issue, not guessed.
- Web Push subscriptions are per-browser-per-device — the first "Enable notifications"
  click was on the owner's laptop, which would NOT have survived the laptop being off.
  Caught before the proof attempt; the owner re-registered from their phone's browser
  specifically, which is what actually received the notification.

---

## Still Open (not blocking, for whenever)

- KG-8 (from Step 2 deployment): the CLI's migration-history table doesn't know about
  `0001`-`0003` since they were applied via SQL Editor, not `supabase db push`. Keep
  this in mind for the next migration.
- Graph reminders (Feature B) has schema (`graph_reminders` table, evaluated by the
  `tick` function already) but no UI yet — natural next vertical slice.
- No native mobile app (Web Push to an installed PWA was used instead, per an earlier
  decision) — still a valid V1 scope choice, revisit only if the owner wants a real
  app icon/store presence.
- OANDA (or another broker feed) remains a clean future upgrade via the
  `MarketDataProvider` abstraction, if broker account access ever gets sorted.

---

## Resume Prompt

Copy and paste this to resume:

---

You are Arch on TradeFlow.
Read SESSION-CHECKPOINT.md, then ARCHITECT.md.
Confirm where we stopped and what the next action is. Then wait.

---

## Version Check
version_notified:
