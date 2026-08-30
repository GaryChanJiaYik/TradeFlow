# Review Request — Step 2
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## Review Fixes (2026-08-30, responding to Richard's round-1 Step 2 review)

All three findings from `handoff/REVIEW-FEEDBACK.md` addressed:

1. **Must Fix (SSRF)** — `packages/validation/src/device.ts`'s `webPushSubscriptionSchema.endpoint`
   now goes through a new `pushEndpointSchema` (`z.string().url().superRefine(...)`) that parses
   the URL and rejects anything whose scheme isn't exactly `https:`, then rejects any hostname not
   in an allowlist of real Web Push service hosts: exact match for `fcm.googleapis.com`,
   `updates.push.services.mozilla.com`, `web.push.apple.com`, and a suffix match
   (`hostname.endsWith(".notify.windows.com")`) for Edge/Windows WNS endpoints. Added
   `packages/validation/src/__tests__/device.test.ts` (new — 9 cases covering a valid endpoint for
   each allowlisted host, http-on-a-valid-host, a non-allowlisted https host — the actual SSRF
   case — a malformed URL, a `file:` scheme, and a lookalike-substring host). This required adding
   `vitest`/`vitest.config.ts`/a `test` script to `packages/validation/package.json` (it had no
   test infra before), matching the existing `alert-engine`/`market-data` pattern.
2. **Should Fix** — `apps/web/app/dashboard/page.tsx`'s alerts query now has `.eq("user_id", user.id)`,
   matching the pattern used everywhere else in `actions.ts` and the now-fixed `edit/page.tsx`.
3. **Documentation gap** — the Files Changed table below now includes `supabase/config.toml` and
   `supabase/.gitignore`.

Verified after fix: `pnpm install`, `pnpm build`, `pnpm test` (23 tests: 8 alert-engine + 6
market-data + 9 validation, all pass), `pnpm typecheck` — all green at repo root. Full narrative
in `handoff/BUILD-LOG.md`'s Step 2 "Review Fixes" entry.

**Ready for Review: YES**

---

## Context: continuation session

A prior Bob instance's process exited unexpectedly partway through Step 2. It had
already built and left in a working state (verified building/passing before this
session started): `packages/market-data/src/oandaProvider.ts` + its 6-test Vitest
suite, the full `supabase/functions/tick/index.ts` + `nextTrigger.ts` (+ its Deno
test) logic, and `supabase/functions/deno.json`. It had NOT yet run the
`supabase functions serve` local verification (Build Order item 2), logged
anything to `handoff/BUILD-LOG.md`, or done Build Order items 3-8. This session
picked up exactly there — verified the prior work, then finished the rest of the
step. See `handoff/BUILD-LOG.md`'s Step 2 entry for the full verification
narrative (a real Windows/Docker-Desktop `supabase functions serve` limitation
was hit and worked around; details there).

## What Was Built

- **OANDA live price feed** (already built by the prior session, verified
  working this session, not modified): `packages/market-data/src/oandaProvider.ts`
  implements `MarketDataProvider` against OANDA's v20 pricing endpoint, using
  `closeoutBid`/`closeoutAsk` (verified against OANDA's own docs, not guessed —
  see the file's comments for why these fields over `bids[0]`/`asks[0]`).
- **The `tick` Edge Function** (already built, verified end-to-end this session
  against a local Supabase stack, one scaffold removed): per cron invocation,
  fetches OANDA's price, evaluates every enabled/unexpired `price_alerts` row via
  the real (imported, not reimplemented) `evaluatePriceAlert`, evaluates due
  `graph_reminders`, sends Web Push via `npm:web-push`, logs to
  `notification_log`, and unconditionally updates `instruments.last_price`.
- **`pg_cron` schedule** (`supabase/migrations/0003_cron.sql`, new this session):
  `cron.schedule` + `net.http_post` every 2 minutes, with the function URL and
  service-role token read from Supabase Vault rather than inlined in the
  migration. Applies cleanly; cannot fire for real until the function is
  deployed and `pg_cron`/`pg_net` are enabled on the real project (owner-side).
- **VAPID keypair + env wiring** (new this session): a real keypair generated
  locally via `npx web-push generate-vapid-keys` (no external account), wired
  into `.env.local.example` files (fake placeholders) and used for real in
  `apps/web/.env.local`/`supabase/functions/.env.local` (both untracked) to
  actually exercise the push flow live.
- **Web Push subscribe flow** (new this session): `apps/web/public/sw.js`
  (push + notificationclick handlers), `apps/web/app/dashboard/notifications-control.tsx`
  ("Enable notifications" client-component island on the dashboard),
  `apps/web/app/dashboard/device-actions.ts` (server action upserting the
  subscription into `devices`, scoped to `auth.uid()`, mirroring the existing
  `actions.ts` defense-in-depth pattern), and `packages/validation/src/device.ts`
  (new `upsertDeviceSchema`/`webPushSubscriptionSchema`, following the existing
  `createPriceAlertSchema` pattern). Verified live against the real cloud
  Supabase project (see Open Questions for the one thing that had to be
  stubbed, and why).
- **Cloudflare deploy scaffolding** (new this session): `apps/web/wrangler.jsonc`,
  `apps/web/open-next.config.ts`, `apps/web/.dev.vars.example`, and `cf:preview`/
  `cf:deploy` scripts, using `@opennextjs/cloudflare` **pinned to `1.15.1`**
  (see Open Questions — the latest published version silently requires Next.js
  15+ and would have been a real, unplanned breaking-change risk). No deploy
  attempted — no confirmed Cloudflare account.
- **Docs**: `README.md`'s COST/FREE TIER section gained OANDA and Cloudflare
  entries; `docs/SETUP.md` gained VAPID generation, local Edge Function serve
  instructions (including the Windows/Docker workaround), and Cloudflare
  preview/deploy instructions.

## Files Changed

| File | Change |
|---|---|
| `packages/market-data/src/oandaProvider.ts`, `src/__tests__/oandaProvider.test.ts`, `vitest.config.ts`, `package.json`, `src/index.ts` | Built by the prior session; verified working, not modified this session. |
| `supabase/functions/tick/index.ts` | Built by the prior session. This session removed the `TEMP-LOCAL-VERIFY` `fetchFn` mock-redirect scaffold from `buildOandaProvider()` (per its own comment) after using it to verify locally — see BUILD-LOG. No other logic changes. |
| `supabase/functions/tick/nextTrigger.ts`, `nextTrigger.test.ts`, `supabase/functions/deno.json` | Built by the prior session; verified working, not modified. |
| `supabase/functions/deno.lock` | New — Deno's lockfile, generated as a byproduct of `deno check`/`deno run` during verification. Kept and tracked for reproducible `npm:` specifier resolution, same rationale as `pnpm-lock.yaml`. |
| `supabase/functions/.env.local.example` | New — tracked, fake-placeholder template for the Edge Function's local secrets (OANDA + VAPID names), mirroring `apps/web/.env.local.example`'s pattern. |
| `supabase/migrations/0003_cron.sql` | New — pg_cron schedule calling the tick function via pg_net, secrets via Supabase Vault. Applies cleanly locally; not run against the real project (see Blocked items in BUILD-LOG). |
| `packages/validation/src/device.ts`, `src/index.ts` | New — `webPushSubscriptionSchema`/`upsertDeviceSchema`, exported from the barrel. |
| `apps/web/public/sw.js` | New — minimal service worker: `push` shows a notification, `notificationclick` focuses/opens `/dashboard`. |
| `apps/web/app/dashboard/notifications-control.tsx` | New — client component: registers the service worker, requests permission, subscribes, calls the server action. Never surfaces raw browser/network errors, only friendly status text. |
| `apps/web/app/dashboard/device-actions.ts` | New — `upsertDeviceAction`: validates via zod, then application-level upsert (find-by-endpoint, update-or-insert) scoped to `auth.uid()`, using the anon-key request-scoped client (never service role). |
| `apps/web/app/dashboard/page.tsx` | Added `<NotificationsControl />` to the dashboard, between the top bar and the alerts table. |
| `apps/web/.env.local.example` | Added `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (fake placeholder). |
| `apps/web/.dev.vars.example` | New — tracked template for wrangler's local dev vars. |
| `apps/web/wrangler.jsonc`, `open-next.config.ts` | New — Cloudflare Workers (via OpenNext) build config. No R2/KV bindings configured (no ISR/SSG pages need one in V1). |
| `apps/web/package.json` | Added `@opennextjs/cloudflare` (pinned `1.15.1`, not latest — see Open Questions) and `wrangler` devDependencies; added `cf:preview`/`cf:deploy` scripts (left `build`/`dev`/`start` untouched). |
| `.gitignore` | Added `.dev.vars`, `.open-next/`, `.wrangler/`. |
| `supabase/config.toml` | New — `supabase init` scaffolding; local Supabase CLI/stack config. No secrets (only commented-out `env(...)` placeholders). |
| `supabase/.gitignore` | New — `supabase init` scaffolding; excludes local CLI state (`.branches`, `.temp`, etc.) from version control. |
| `README.md` | Status/Structure sections updated for Step 2; COST/FREE TIER gained OANDA and Cloudflare entries per spec section 37. |
| `docs/SETUP.md` | Added: VAPID keypair generation + env var placement, local Edge Function serve instructions (including the Windows/Docker `supabase functions serve` workaround), Cloudflare preview/deploy instructions. |
| `handoff/BUILD-LOG.md` | Step 2 entry: what was verified, how, key decisions, and everything explicitly blocked. |

## Open Questions

1. **`VAPID_SUBJECT`'s real `mailto:` address** — the brief says to ask the
   owner if not already documented; it isn't documented anywhere in this repo.
   Used `mailto:fake-placeholder@example.com` in tracked `.env.local.example`
   files and `mailto:placeholder@example.com` for local verification (both
   clearly fake, per the brief's flag against fabricating anything
   real-looking). Needs a real contact address before any real deploy.
2. **Cloudflare Workers vs. Pages** (carried over from the prior session's
   already-approved plan in `handoff/ARCHITECT-BRIEF.md`'s Builder Plan
   section — restating here since it materially affects deploy mechanics):
   `@opennextjs/cloudflare` deploys to Cloudflare **Workers**, not classic
   Cloudflare **Pages**, which is what the original brief text says. This was
   already flagged and reasoned through by the prior session (OpenNext is the
   actively maintained, non-deprecated path for an App Router app with server
   actions; `@cloudflare/next-on-pages` is legacy and Edge-runtime-only).
   Restating for an explicit nod before an actual `wrangler deploy` ever
   happens — no deploy has been attempted either way.
3. **`@opennextjs/cloudflare` pinned to `1.15.1`, not latest** (new finding
   this session, not anticipated by the prior session's plan): the latest
   published version (`1.20.4` at the time of this session) requires Next.js
   `>=15.5.24` and has fully dropped Next 14 support — confirmed via `npm view`
   across the version history. `1.15.1` is the last version whose peer range
   includes our pinned Next `14.2.35`. This is a real constraint, not a
   preference: upgrading past `1.15.x` requires first upgrading Next 14 -> 15
   across the whole `apps/web` app (Next 15 makes `cookies()`/`headers()`
   async), a separate, unplanned decision this session did not make. Flagging
   so it isn't silently "fixed" later by bumping the Cloudflare adapter without
   realizing it drags Next 15 in with it.
4. **One browser-internal step stubbed during live Web Push verification** —
   the actual FCM/GCM push-service handshake inside `pushManager.subscribe()`
   would not complete in this session's sandboxed execution environment under
   any configuration tried (ephemeral context: blocked outright by Chrome's
   deliberate incognito restriction on the Push API; persistent profile,
   headless or headed: "push service not available", i.e. no reachable path to
   Google's push infrastructure from this sandbox). Everything else in the flow
   — real signup, real service worker registration, real permission-request
   call, the real server action, and real RLS-scoped persistence to the live
   `devices` table — was verified with that one call's return value stubbed to
   a realistic-shaped fake `PushSubscription`. Recommend a real end-user
   browser test (or a CI runner with genuine internet egress reaching Google's
   push infrastructure) before fully trusting live push *delivery*; the
   *subscribe-and-persist* path is fully verified as-is. Full narrative in
   `handoff/BUILD-LOG.md`.
5. **`supabase functions serve` doesn't work reliably on Windows + Docker
   Desktop** for this function's import shape (see BUILD-LOG for the full
   diagnosis) — worked around via direct `deno run` for this session's
   verification, which exercises the identical source and import map. Not a
   code defect; flagging in case Arch/owner wants to retest with a different
   host or a newer Supabase CLI release before relying on `functions serve`
   for future iteration.
6. **Leftover test data in the real cloud Supabase project**: a handful of
   `push-verify-*@example.com` test users (one `devices` row each) from the
   live browser verification. Harmless, not cleaned up (no service-role key
   available to this session for that project) — owner/Arch can delete via
   the dashboard if desired.

## Known Gaps Logged
See `handoff/BUILD-LOG.md` KG-5 through KG-7 (new this session) and the
pre-existing KG-2/KG-3/KG-4 from Step 1 (unchanged).

**Ready for Review: YES**
