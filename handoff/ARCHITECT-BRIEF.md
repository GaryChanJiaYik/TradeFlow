# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 2 — Live price feed, cron worker, Web Push, deploy scaffolding

Step 1 is clear and verified live (owner confirmed the full local walkthrough works
against a real Supabase project). This step wires in the actual data feed and
notification pipeline. The owner's OANDA practice account signup is currently blocked
(login/account-creation issue on OANDA's side) — build everything that does NOT require
a live OANDA token first; the OANDA-dependent pieces are structured so credentials can
be dropped in later with no further code changes, exactly like Step 1 handled the
missing Supabase project.

### Decisions

- **OANDAProvider** (`packages/market-data/src/oandaProvider.ts`): implements
  `MarketDataProvider` via `GET {baseUrl}/v3/accounts/{accountID}/pricing?instruments=XAU_USD`,
  `Authorization: Bearer ${OANDA_API_TOKEN}`. `baseUrl` is
  `https://api-fxpractice.oanda.com` when `OANDA_ENV=practice` (the only value used in
  V1 — do not add a `live` code path, just don't hard-code the string so it isn't
  scattered everywhere). Parse the response's `prices[0].closeoutBid`/`closeoutAsk`
  (or `.bids[0].price`/`.asks[0].price` depending on OANDA's actual v20 response shape
  — verify against OANDA's published schema, don't guess the field name) and use the
  midpoint as `PriceUpdate.price`. Unit test with a mocked `fetch` (no live token
  needed) covering: a successful parse, an HTTP error status, and a malformed/empty
  `prices` array (must throw or return a typed error, never silently return `NaN`).
- **Env vars / secrets** (fix these names now): `OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`,
  `OANDA_ENV=practice` — Edge Function secrets only, never in `apps/web`'s client bundle.
  `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (a `mailto:` address —
  ask the owner for the address to use if not already documented in
  `docs/SETUP.md`; otherwise use a placeholder and flag it). Generate the VAPID keypair
  yourself with `npx web-push generate-vapid-keys` (no external account needed for
  this — it's a local keypair, not a signup). Client build also needs
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (same value as `VAPID_PUBLIC_KEY`, just re-exposed
  under the `NEXT_PUBLIC_` prefix Next.js requires for client-side access — the public
  key is not a secret, the private key is).
- **Edge Function** (`supabase/functions/tick/index.ts`, Deno, the pg_cron target):
  per invocation — for the XAUUSD `instruments` row: call `OANDAProvider.getPrice`,
  compare against `instruments.last_price` via `evaluatePriceAlert` for every enabled,
  unexpired `price_alerts` row on that instrument; on trigger, update
  `last_triggered_at` (and set `enabled = false` if `trigger_mode = 'ONCE'`), insert a
  `notification_log` row, and send a Web Push notification (via the `web-push` npm
  package, importable in Deno via `npm:web-push`) to every enabled `devices` row for
  that alert's user. Then evaluate `graph_reminders` with `next_trigger_at <= now()`
  the same way (push + compute/store the next occurrence), then unconditionally update
  `instruments.last_price`/`last_price_at` to the tick just fetched — even on ticks
  with no triggers, so the next invocation has a correct baseline. Use the Supabase
  **service role** client inside this function (it's the one place service-role
  access is needed — RLS is bypassed by design here since there's no logged-in user in
  a cron context).
- **Importing `evaluatePriceAlert` into the Deno function**: import it via a **relative
  path** to the TS source (e.g. `../../../packages/alert-engine/src/evaluatePriceAlert.ts`),
  not via the `@tradeflow/alert-engine` workspace package specifier — Deno executes
  TypeScript directly and doesn't need node_modules resolution for relative imports, so
  no esbuild/bundling step should be necessary. The file's only import is
  `import type { PriceAlert } from "@tradeflow/types"`, which is a type-only import
  erased at compile time — it should not exist at runtme, but Deno's built-in
  type-checker may still try to resolve it. **Verify this empirically** with
  `supabase functions serve` locally before assuming it works: if Deno's type-checker
  chokes on the unresolvable `@tradeflow/types` specifier, add a `deno.json` import map
  in `supabase/functions/` mapping `@tradeflow/types` to a relative path, or run the
  function with type-checking relaxed for that specifier — do not silently duplicate
  `evaluatePriceAlert`'s logic inline in the Edge Function as a workaround; that would
  let the tested and deployed logic drift apart. If truly stuck, escalate to Arch
  rather than guessing.
- **pg_cron** (`supabase/migrations/0003_cron.sql`): `cron.schedule(...)` calling the
  deployed `tick` function's URL via `net.http_post` (`pg_net`) every 2 minutes. Write
  the migration, but note in your plan that it can't actually run until (a) the
  `tick` function is deployed (needs `supabase functions deploy`, which needs the
  project linked via the Supabase CLI — owner-side) and (b) the `pg_cron`/`pg_net`
  extensions are enabled for the project (a one-time dashboard toggle — ask Arch to
  confirm with the owner, don't assume they're already on).
- **Web Push subscription flow**: `apps/web/public/sw.js` — a minimal service worker
  with `push` (call `self.registration.showNotification`) and `notificationclick`
  (focus/open the app) handlers. An "Enable notifications" control in the dashboard
  that calls `Notification.requestPermission()` then
  `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey:
  <NEXT_PUBLIC_VAPID_PUBLIC_KEY, base64url-decoded to a Uint8Array> })`, then a server
  action (mirroring the existing alert-actions pattern in
  `apps/web/app/dashboard/actions.ts`) that upserts the resulting `PushSubscription`
  JSON into `devices`, scoped to `auth.uid()` — do not use the service role here, this
  is a user-initiated write and RLS + explicit `user_id` scoping (same defense-in-depth
  pattern Richard required in Step 1) both apply.
- **Deploy target**: Cloudflare Pages, per the existing plan — but do not attempt the
  actual deploy in this step unless the owner confirms they have a Cloudflare account
  ready. Get the app deploy-ready (correct build config, e.g. the OpenNext Cloudflare
  adapter or `@cloudflare/next-on-pages`, whichever you determine is the better current
  fit for Next.js 14 App Router with server actions — flag your choice and reasoning
  rather than silently picking one if it materially affects what does/doesn't work),
  but treat the actual `wrangler`/dashboard deploy step as blocked pending the owner,
  same as the Supabase project was in Step 1.

### Build Order
1. `packages/market-data/src/oandaProvider.ts` + unit tests (mocked `fetch`, no live token).
2. `supabase/functions/tick/index.ts` — build and verify locally via `supabase functions serve` with a stubbed/mocked OANDA response (do not wait on a real token to get this far); confirm the alert-engine import approach works as described above.
3. `supabase/migrations/0003_cron.sql`.
4. VAPID keypair generation + env var wiring (`.env.local.example` updated with the new names, real values only in untracked `.env.local`/Supabase secrets).
5. `apps/web/public/sw.js` + subscribe UI + devices-upsert server action.
6. Cloudflare deploy config (adapter setup, build script) — actual deploy deferred pending owner's Cloudflare account confirmation.
7. Update `README.md`'s COST/FREE TIER section to add OANDA and Cloudflare Pages entries (purpose, free-tier limit, what happens if exceeded, potential paid cost, alternative) — do this even though they're not live yet, per spec section 37.
8. Update `docs/SETUP.md` with the new env vars and the Deno-function local-serve instructions.

### Flags
- Flag: No live `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID` exist yet — do not fabricate placeholder values that look real; use obviously-fake ones in `.env.local.example` only, and do not attempt to invoke the real OANDA endpoint from tests or local runs.
- Flag: Do not guess the exact OANDA v20 pricing response field names — check OANDA's own v20 API documentation (developer.oanda.com) for the actual `Price` object schema rather than assuming a shape.
- Flag: pg_cron/pg_net extension enablement and the actual `supabase functions deploy` are owner/Arch-side actions requiring dashboard/CLI access this run doesn't have — write the migration and function code, but don't claim the schedule is "running" until those happen.
- Flag: Cloudflare deploy — confirm with Arch whether the owner has an account before spending time on deploy-specific configuration beyond making the app deployable in principle.
- Flag: If the relative-path import of `evaluatePriceAlert` into the Deno function doesn't work cleanly after real verification, escalate to Arch with what you tried rather than duplicating the logic.

### Definition of Done
- [ ] `pnpm build`, `pnpm test`, `pnpm typecheck` still pass at repo root (including new OANDAProvider tests).
- [ ] `supabase functions serve` runs `tick` locally against a mocked/stubbed price and correctly evaluates a test alert (documented how you stubbed it).
- [ ] Service worker + subscribe flow: a real browser can grant permission, subscribe, and the subscription is persisted to `devices` scoped to the signed-in user (this CAN be verified live now, since it doesn't need OANDA — do this against the existing Supabase project).
- [ ] `README.md` and `docs/SETUP.md` updated per Build Order items 7-8.
- [ ] Everything OANDA-credential-dependent (a real price fetch, the live cron schedule actually firing, the full milestone proof) is explicitly logged as blocked in `handoff/BUILD-LOG.md`, not silently skipped.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

Non-interactive background run — proceeding directly to build per Bob's
instructions for this session, since neither flagged sub-decision below
blocks the unambiguous rest of the step. Both are resolved with evidence
rather than left as guesses; noted as open questions in REVIEW-REQUEST for
Arch/Richard to confirm, not silently decided.

**Tooling check (done before planning):** `supabase` CLI unavailable as a
global binary but runnable via `npx -y supabase@latest` (v2.116.0, confirmed
working); `deno` was not installed in this environment — installed it locally
via the official `deno.land/install.ps1` script (v2.9.6) specifically so
Build Order step 2's "verify empirically with `supabase functions serve`"
requirement is a real test, not a guess. Both are dev-machine tooling, not
project dependencies — nothing about them goes into the repo.

**Flag 1 resolved — OANDA v20 pricing field names** (checked
developer.oanda.com directly, not guessed):
- `GET /v3/accounts/{accountID}/pricing` → `{ prices: ClientPrice[], time, homeConversions? }`.
- `ClientPrice` has both `closeoutBid`/`closeoutAsk` (each a `PriceValue`
  string) AND `bids`/`asks` (each `PriceBucket[]`, `PriceBucket = { price: PriceValue, liquidity }`).
- Per OANDA's own docs (pricing-common-df) and community sources: `bids`/`asks`
  arrays can legitimately be **empty** when there's no liquidity on that side;
  `closeoutBid`/`closeoutAsk` are fallback scalars specifically designed to
  always be present in that situation (they exist so a closeout price is
  always computable). Since this app only needs "a reliable current price to
  compare against alert thresholds" (never opens/closes real positions), I'm
  using **`closeoutBid`/`closeoutAsk`** as the primary source, midpointed —
  this avoids an extra empty-array fallback path for the common case and is
  the more robust field to depend on. `OANDAProvider` still throws a typed
  error if `prices` is empty/missing or if either closeout field is
  missing/non-numeric — never returns `NaN`.
- Instrument name uses OANDA's underscore format (`XAU_USD`), separate from
  our own `instruments.symbol` (`XAUUSD`) — `OANDAProvider.getPrice` takes
  our symbol and maps it internally (only one mapping needed for V1).

**Flag 2 resolved — Cloudflare adapter choice** (materially affects the
brief's stated deploy target, so flagging explicitly rather than picking
quietly): Cloudflare's own `@cloudflare/next-on-pages` is now legacy —
Cloudflare's current docs and repo point developers at the **OpenNext
Cloudflare adapter (`@opennextjs/cloudflare`)** instead, specifically because
`next-on-pages` only supports the Edge runtime (which blocks Node APIs
several server-action-adjacent things may need), while OpenNext runs Next on
the Node.js-compatible Workers runtime and explicitly supports SSR, ISR,
middleware, and server actions. The catch: **OpenNext's Cloudflare adapter
deploys to Cloudflare Workers, not classic Cloudflare Pages** — the brief
says "Cloudflare Pages, per the existing plan." I'm proceeding with OpenNext
(the technically better-supported, non-deprecated path for an App Router app
with server actions) and configuring `wrangler.jsonc` + build scripts for it,
but flagging for Arch/owner: this deploys under Cloudflare's Workers product,
not Pages. No live deploy happens either way this step (owner's Cloudflare
account isn't confirmed), so this doesn't block anything — just needs a
nod before an actual `wrangler deploy` happens later.

**Build order:** following the brief's 8 steps as written. Devices-upsert
server action gets its own zod schema in `packages/validation` (mirroring
the existing `createPriceAlertSchema` pattern) rather than hand-rolled
validation, for consistency with Step 1. The "Enable notifications" control
goes on the existing dashboard page as a small client component (root
layout is a server component, so push subscription wiring — which needs
`navigator`/`window` — has to live in a client component island, same
pattern implied by the existing edit-form client component).

**Verification plan:** `pnpm build`/`test`/`typecheck` at repo root;
`OANDAProvider` unit tests with mocked `fetch` (success, HTTP error,
empty/malformed `prices`); `supabase functions serve` run locally against
the real linked Supabase project (already live from Step 1) with OANDA
calls stubbed (env var pointing at a local mock HTTP server, or a
serve-time override — decided during implementation and documented in
BUILD-LOG); real browser test of the push subscription flow against the
live Supabase project (this doesn't need OANDA). Actual `supabase functions
deploy`, pg_cron/pg_net enablement, and any Cloudflare deploy stay blocked
per the brief's flags — logged, not attempted.

Architect approval: [x] Approved (proceeding per non-interactive run instructions — both flagged sub-decisions resolved with cited evidence above and logged as open questions for Arch/Richard rather than blocking silently)
