# Session Checkpoint — 2026-09-02

---

## Where We Stopped

Steps 1-5 are all built, reviewed, deployed, and owner-verified live in production:
- Step 1-2: auth, price alerts, Binance PAXG feed, cron worker, Web Push (Milestone 1 proven).
- Step 3: graph reminders CRUD.
- Step 4: fixed unauthenticated access to the "new alert"/"new reminder" pages.
- Step 5: fixed a reminder-timezone display bug (stored values were always correct;
  display wasn't converting to the reminder's own timezone on Cloudflare Workers'
  UTC-default runtime) and added an optional per-reminder market-open/close window
  that anchors the 15m/1H/4H/1D grid to a custom start time instead of midnight.

Live at:
- Web app: https://tradeflow-web.garychanjiayik.workers.dev
- Code: https://github.com/GaryChanJiaYik/TradeFlow (branch `main`)

Nothing is currently blocked. Ready for the next piece of work — no open bugs or
pending reviews as of this checkpoint.

---

## What Was Decided This Session (since the last checkpoint)

- Reminder scheduling window arithmetic: next-occurrence-after-rollover distance is
  `1440 - offset` (window instances repeat every 1440 minutes regardless of window
  length) — a formula Arch's own brief got wrong on the first attempt; Bob caught it,
  Richard independently re-derived and confirmed it in a separate review pass.
- Window is per-reminder (not global), stored as nullable `time` columns
  (`window_start_time`/`window_end_time`), both-or-neither enforced at both the DB
  (CHECK constraint) and validation (zod refine) layers. Equal start/end values
  normalize to null/null ("no restriction"), per the owner's own framing.
- Confirmed this network cannot run `supabase db push`/`migration list` at all
  (direct Postgres ports blocked) — every schema change from here needs the same
  dashboard SQL Editor workaround used for `0003_cron.sql` and `0004_reminder_window.sql`.

---

## Still Open (not blocking, background awareness)

- OANDA (or another broker feed) remains a clean future upgrade via the
  `MarketDataProvider` abstraction, if broker account access ever gets sorted.
- No native mobile app (Web Push to an installed PWA instead) — still a valid V1
  scope choice.
- Spec Phase 17 (general polish/security/reliability hardening) hasn't been
  deliberately worked through yet, though Steps 4-5 both originated as exactly that
  kind of hardening found via ad-hoc testing rather than a systematic pass.

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
