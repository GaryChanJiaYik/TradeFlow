# Session Checkpoint — 2026-08-30

---

## Where We Stopped

Step 1 (repo scaffold, schema/RLS, auth, alert CRUD, alert-engine with full
test coverage) is built, reviewed, fixed, and re-reviewed clear by Richard.
Committed locally (`766bc6c`, `eae9166`). Next action: owner creates a free
Supabase project and hands Arch the project URL + anon key, so the remaining
Step 1 Definition-of-Done items (live dev boot, manual CRUD walkthrough,
two-user RLS check, live Playwright run) can be confirmed with no further
code changes — then Arch drafts the Step 2 brief (OANDAProvider, pg_cron
Edge Function, Web Push, Cloudflare Pages deploy) per the approved plan.

---

## What Was Decided This Session

- XAUUSD data source: OANDA demo/practice v20 REST API (polled, not
  streamed) — MT5 rejected for V1 (would need a paid Windows VPS).
- No always-on server/VPS: Supabase pg_cron + Edge Function every 2 minutes
  is the entire "cloud worker," fully inside Supabase's free tier.
- Push notifications: Web Push to an installable PWA, not a native
  Expo/React Native app, for V1.
- Hosting: Cloudflare Pages (matches the spec's own stack preference).
- Local dev: against a real cloud Supabase free-tier project, no local
  Docker `supabase start` stack.
- `instruments.last_price`/`last_price_at` hold the "previous price" for
  crossing comparisons — no separate price-ticks table in V1.
- `PROJECT_SPEC.txt` now holds the owner's actual verbatim spec (replacing
  Bob's Step-1 reconstruction).

---

## Still Open

- Owner needs to create the Supabase project and share the URL + anon key.
- Owner needs to create an OANDA practice account (name/email/phone, no ID
  docs) and generate an API token + account ID before Step 2 can start —
  can be done in parallel, not blocking.
- Step 2 brief (OANDAProvider, Edge Function, pg_cron, Web Push, deploy) not
  yet written — waiting on the above so it isn't handed to Bob with unknowns.

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
