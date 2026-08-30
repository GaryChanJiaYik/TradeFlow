# Session Checkpoint — 2026-08-30

---

## Where We Stopped

Steps 1 and 2 are both built, reviewed, fixed, and re-reviewed clear by Richard.
Committed locally through `0df58cd`. Step 2 added the live OANDA price feed, the
pg_cron-invoked Edge Function (alert/reminder evaluation + Web Push), the
subscription flow (verified live against the real Supabase project), and
Cloudflare Workers deploy scaffolding (not yet deployed). Richard caught and
Bob fixed a real SSRF hole in the Web Push endpoint validation along the way.

Nothing is deployed to production yet. What's blocking that, all owner/Arch-side:
- Owner's OANDA practice account signup is stuck (login/account-creation issue
  on OANDA's end) — no OANDA_API_TOKEN/OANDA_ACCOUNT_ID yet.
- `pg_cron`/`pg_net` extensions not yet enabled on the live Supabase project.
- `supabase functions deploy` not yet run against the live project.
- No confirmed Cloudflare account for the actual `wrangler deploy`.
- VAPID_SUBJECT contact email — asked owner, no answer yet.
- A few harmless `push-verify-*@example.com` test users are sitting in the
  live Supabase project from live verification — owner can delete via the
  dashboard whenever, not urgent.

Next action once OANDA/Cloudflare/extensions are sorted: deploy the function,
enable pg_cron/pg_net, deploy the web app, then run the actual Milestone 1
proof (create a real alert, close the browser, laptop off, wait for a real
crossing, confirm the phone gets the push). No further Bob/Richard cycles
should be needed for that — it's owner+Arch executing what's already built.

---

## What Was Decided This Session

- (Carried from before) OANDA demo/practice API, Supabase pg_cron + Edge
  Function (no VPS), Web Push to a PWA (no native app), Cloudflare deploy.
- Cloudflare deploy target is Workers (via `@opennextjs/cloudflare`), not
  classic Pages — OpenNext is the actively-maintained path for Next.js App
  Router + server actions; approved by Arch.
- `@opennextjs/cloudflare` pinned to `1.15.1` — latest requires Next.js 15+;
  upgrading is a deliberate future decision, not an incidental side effect of
  an adapter bump.
- Cron job secrets (function URL, service-role token) go through Supabase
  Vault, never inlined in the migration — `cron.job.command` is
  plaintext-readable via the Postgres catalog.
- Web Push subscription endpoints are validated against an https-only +
  real-hostname allowlist (fcm.googleapis.com / Mozilla / Apple / WNS), not
  just `z.string().url()` — closes an SSRF path where an arbitrary endpoint
  would get a recurring server-triggered request every 2 minutes.

---

## Still Open

- Owner: unstick OANDA signup, hand over API token + account ID.
- Owner: confirm a Cloudflare account, or say if a different free host is
  preferred instead.
- Owner: VAPID_SUBJECT contact email.
- Owner/Arch: enable `pg_cron`/`pg_net` extensions on the live Supabase
  project dashboard.
- Arch: once the above land, run `supabase functions deploy`, deploy the web
  app, then the real Milestone 1 laptop-off proof.

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
