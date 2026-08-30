# Review Feedback — Step 2
*Written by Reviewer. Read by Builder and Architect.*

Date: 2026-08-30
Ready for Builder: YES

---

## Round 2 (2026-08-30, re-review of Bob's claimed fixes)

Verified all three items from Round 1 directly against the current files — not just
Bob's narrative in `REVIEW-REQUEST.md`.

1. **Must Fix (SSRF) — RESOLVED.** Read `packages/validation/src/device.ts` in full.
   `pushEndpointSchema` parses `endpoint` with the real `URL` constructor (not a
   string search) and checks `url.protocol !== "https:"`, then `url.hostname`
   against `isAllowedPushEndpointHost`: an exact-match list
   (`fcm.googleapis.com`, `updates.push.services.mozilla.com`,
   `web.push.apple.com`) plus a suffix check
   (`lowerHost.endsWith(".notify.windows.com")`, suffix carries its own leading
   dot). Traced the specific bypasses this class of bug usually falls to:
   - `https://fcm.googleapis.com.evil.example.com/...` — `url.hostname` is the
     full `fcm.googleapis.com.evil.example.com`, not equal to any allowlist
     entry, does not end in `.notify.windows.com` — **rejected**.
   - `https://evil.com/fcm.googleapis.com` — path, not host; `url.hostname` is
     `evil.com` — **rejected**.
   - `https://user@fcm.googleapis.com@evil.com/` (userinfo trick) — `URL`
     parses the real host as `evil.com`; `fcm.googleapis.com` ends up in the
     userinfo, never inspected — **rejected**.
   - `https://evilnotify.windows.com.attacker.com/` — does not end in
     `.notify.windows.com` (ends in `.attacker.com`) — **rejected**.
   - `https://notevil-notify.windows.com/` — the leading dot in the suffix
     constant means this must end in a literal `.notify.windows.com`; the
     character before `notify` here is `-`, not `.`, so it does **not** match
     — **rejected**. This confirms the suffix check is anchored on a real
     label boundary, not a careless `.includes()`/undotted `.endsWith()`.
   - Case and IDN: `hostname` is lowercased before comparison (redundant with
     but not weaker than the URL parser's own lowercasing), and any Unicode
     confusable host would come back from the parser as a distinct punycode
     (`xn--...`) string that cannot collide with the plain-ASCII allowlist.
   Ran `packages/validation/src/__tests__/device.test.ts` directly
   (`npx vitest run` in `packages/validation`): all 9 tests pass, including the
   "rejects a host that merely contains an allowlisted host as a substring"
   case (`https://fcm.googleapis.com.evil.example.com/...`), which is exactly
   the bypass this fix needs to close. No gap found — this closes the SSRF
   primitive from Round 1.
2. **Should Fix (missing `user_id` filter) — RESOLVED.** Read
   `apps/web/app/dashboard/page.tsx` in full: the alerts query now reads
   `.from("price_alerts").select(...).eq("user_id", user.id).order(...)`,
   matching the defense-in-depth pattern used elsewhere in the app.
3. **Documentation gap — RESOLVED.** `handoff/REVIEW-REQUEST.md`'s Files
   Changed table now lists `supabase/config.toml` and `supabase/.gitignore`
   with accurate descriptions.

No new findings. Nothing else from Step 2 was re-reviewed (out of scope for
this pass, per Round 1's Cleared section).

**Step 2 is clear.**

---

## Must Fix (Round 1 — RESOLVED, see Round 2 above)
*Blocks the step. Builder fixes before anything moves forward.*

- `packages/validation/src/device.ts:9-16` (`webPushSubscriptionSchema`) — `endpoint: z.string().url()` accepts a URL of **any** scheme/host, not just a real browser push-service endpoint. This value comes straight from the client (`apps/web/app/dashboard/notifications-control.tsx` → `upsertDeviceAction`), and a Next.js Server Action is reachable by anyone with a valid session issuing a raw request — not only via the browser's actual `PushManager.subscribe()`, which would only ever produce endpoints under known push-service domains (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, etc.). Once stored, `supabase/functions/tick/index.ts`'s `pushToUserDevices` feeds `device.subscription` straight into `webpush.sendNotification` **unconditionally, every 2 minutes, from server infrastructure**, for as long as the device row stays `enabled`. A registered user (a self-serve signup — not a privileged account) can therefore plant an arbitrary URL — including internal/private hosts, cloud-metadata-style addresses, or just an unbounded third party — and get a recurring, server-triggered outbound HTTP POST against it: a real SSRF primitive, not a theoretical one. Fix: at minimum, refine the schema to require `endpoint` to start with `https://` (rejects `file:`/other schemes); consider going further with a same-origin-family allowlist against the known push-service hosts if that's judged worth the maintenance cost for V1.

## Should Fix (Round 1 — RESOLVED, see Round 2 above)
*Does not block. Fix inline if under 5 minutes, otherwise log to BUILD-LOG.*

- `apps/web/app/dashboard/page.tsx` (the alerts listing query, `~line 26-30`: `.from("price_alerts").select("*, instruments(symbol, name)").order("created_at", ...)`) — this predates Step 2 (introduced in Step 1's `766bc6c`, untouched by this step's actual diff beyond adding `<NotificationsControl />` next to it) but is the exact same pattern already flagged as a Round 1 Must Fix on `edit/page.tsx`: no `.eq("user_id", user.id)`, relying on RLS alone to keep this the signed-in user's own alerts. RLS in `0002_rls.sql` does correctly block cross-user reads today, so there's no live leak — but it's now the one remaining query in `apps/web` that breaks the app-side defense-in-depth pattern used everywhere else (`actions.ts`, the now-fixed `edit/page.tsx`, and this step's own `device-actions.ts`). Since the file was already open for this step, worth a one-line fix now rather than carrying it forward again: add `.eq("user_id", user.id)`.
- `handoff/REVIEW-REQUEST.md`'s "Files Changed" table doesn't list `supabase/config.toml` or `supabase/.gitignore`, both of which show up as new/untracked in git status (`supabase init`/`supabase start` byproducts). Read both to check for anything real-looking — both are clean (standard CLI scaffolding, `config.toml`'s only secret-shaped lines are commented-out `env(...)` references) — but the file list should account for everything being committed. Log to BUILD-LOG or fold into the file list on the next pass; not a defect in the files themselves.

## Escalate to Architect
*Product or business decision required.*

None. Both items above are code-level fixes within normal Builder discretion — no product/business call needed. (Arch's existing resolutions on Q1-Q6 in `handoff/BUILD-LOG.md` are noted and not revisited here; Q4/Q5 are informational per Arch's own note and don't need a review verdict.)

## Cleared

- `supabase/functions/tick/index.ts` — every query is correctly scoped for what it needs to do as a service-role client: `pushToUserDevices` filters `devices` by `.eq("user_id", userId).eq("enabled", true)`; `processPriceAlerts`'s `price_alerts` query is intentionally *not* user-scoped (cron must evaluate every user's alerts for the instrument) but is correctly scoped by `.eq("instrument_id", ...).eq("enabled", true)` plus the not-expired `.or(...)`; `graph_reminders` likewise correctly evaluates across all users via `.eq("enabled", true).lte("next_trigger_at", now)`. `last_triggered_at`/`enabled=false` (ONCE mode) is written **before** the push attempt, matching PROJECT_SPEC.txt section 13 correctly — "trigger" there is the price-crossing event, marked consumed once detected, independent of whether the notification later fails to deliver. `pushToUserDevices` wraps `webpush.sendNotification` per-device in try/catch (only a 404/410 disables the device; anything else is logged and the loop continues), and the OANDA-fetch / price-alert path and the graph-reminder path are each in their own top-level try/catch, so a fetch or push failure in one never blocks the other or crashes the function.
- `supabase/functions/tick/nextTrigger.ts` (`computeNextTriggerAt`) — traced the 15m/1H/4H arithmetic (floor current wall-clock minutes-of-day to the timeframe's step, then add one full step) and the 1D case (floor to local midnight, add 24h): both always land strictly after `from`, never repeat the same instant even when `from` sits exactly on a boundary, and correctly roll over day/month/year via `Date.UTC`'s own overflow normalization before being converted back through the timezone via `zonedWallClockToUtc`. No fixed-offset-from-now drift.
- `supabase/migrations/0003_cron.sql` — confirmed by reading the SQL directly (not just the narrative): the `cron.schedule` job body contains no literal secret, only two `select decrypted_secret from vault.decrypted_secrets where name = '...'` subqueries for the function URL and bearer token. The rationale given (`cron.job.command` is plaintext and catalog-readable) is accurate. The two `vault.create_secret` calls with real values are documented in a comment for the owner to run by hand, not executed by the migration itself.
- `apps/web/app/dashboard/device-actions.ts` — uses `createClient()` from `@/lib/supabase/server`, confirmed (by reading that file) to be built from `NEXT_PUBLIC_SUPABASE_ANON_KEY` plus the request's cookies, never a service-role key. Every read/write is scoped by `user.id` from `supabase.auth.getUser()` in addition to RLS: the existing-row lookup filters `.eq("user_id", user.id).eq("subscription->>endpoint", ...)`, the update adds `.eq("user_id", user.id)` again, and the insert sets `user_id: user.id` directly — genuine defense-in-depth, matching the established pattern.
- `packages/market-data/src/oandaProvider.ts` — `closeoutBid`/`closeoutAsk` are read as strings and validated with `Number.isFinite` before use; a missing/non-numeric value throws a typed `OANDAProviderError` rather than ever returning `NaN` to the caller. Not modified this session; reads correctly as described.
- `apps/web/public/sw.js` / `notifications-control.tsx` — the service worker safely falls back to a generic notification on a non-JSON push payload rather than throwing; the client component never surfaces raw browser/network errors, only friendly status text, and the one `as BufferSource` cast is a documented type-only lib.dom mismatch, not a runtime concern.
- Secrets hygiene — `apps/web/.env.local.example`, `apps/web/.dev.vars.example`, `supabase/functions/.env.local.example` all contain only obviously-fake placeholder values; `.gitignore`'s new `.dev.vars`/`.open-next/`/`.wrangler/` entries and `supabase/.gitignore` correctly exclude local secrets and build output. No real-looking credential found in any tracked file.
