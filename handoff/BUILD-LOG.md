# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** Step 1 — Repo scaffold, schema, auth, alert CRUD, alert-engine core
**Last cleared:** none yet (first step)
**Pending deploy:** N/A — no deploy target yet; blocked on Supabase project creation (see Known Gaps)

---

## Step History

### Step 1 — Repo scaffold, schema, auth, alert CRUD, alert-engine core — Status: BLOCKED (partial — see below)
*Date: 2026-08-30*

Files changed: see `handoff/REVIEW-REQUEST.md` for the full file list with rationale.

Decisions made:
- Package manager pinned via `packageManager: pnpm@9.12.3` in root `package.json`; Next.js 14.2.x (App Router, not 15) chosen specifically so `next/headers` `cookies()` stays synchronous, matching the standard `@supabase/ssr` server-client pattern.
- Internal cross-package relative imports use extensionless specifiers (`./enums`, not `./enums.js`) — `moduleResolution: "Bundler"` in `tsconfig.base.json` allows this, and it was required to make Next.js's webpack bundler resolve `@tradeflow/*` workspace packages consumed as raw TS source (via `transpilePackages`) rather than pre-compiled `dist/` output. Originally written with `.js` extensions per common ESM-NodeNext convention; switched after `pnpm build` failed with "Module not found" errors in `apps/web`.
- Added a `handle_new_user` trigger on `auth.users` (in `0001_init.sql`) to auto-create the matching `profiles` row on signup. Not explicitly requested in the brief, but without it the `profiles` table (which the brief does specify) would never be populated by anything — this is plumbing to make the specified schema functional, not a new feature.
- `docs/SETUP.md` instructs turning off Supabase's "Confirm email" setting for local/e2e use, because `apps/web/e2e/alert-crud.spec.ts` logs in immediately after signup and cannot do so if email confirmation is required first.
- Server actions (not client-side fetch + API routes) used for all alert CRUD and auth flows, using React 18's `useFormState`/`useFormStatus` from `react-dom` — standard Next.js 14 App Router pattern, keeps the UI functional without additional client-side data-fetching libraries.
- No Database-generated TypeScript types from Supabase CLI (`supabase gen types typescript`) — that requires a live project to introspect, which does not exist yet. Query results are typed manually via `.returns<T>()` casts against `@tradeflow/types` interfaces instead. Should be replaced with generated types once the project exists (Step 2 or later).

Architect notes (2026-08-30): Reviewed Bob's open questions from REVIEW-REQUEST.md.
- Open Question 1 (PROJECT_SPEC.txt provenance) — RESOLVED. Replaced the reconstructed
  file with the owner's actual verbatim spec text (had it from the planning conversation).
  KG-3 is closed.
- Open Questions 2-5 (handle_new_user trigger, no generated Database type yet,
  extensionless workspace-package imports, unpinned-by-brief dependency versions) —
  APPROVED as built. All are sound, low-risk technical calls within normal Builder
  discretion; no changes requested.

Reviewer findings (2026-08-30, Richard's first pass): 1 Must Fix, 1 Should Fix — both addressed same day, see "Review Fixes" below.
Deploy: N/A — not deployed anywhere yet.

**Review Fixes (2026-08-30):**
- **Must Fix** — `apps/web/app/dashboard/alerts/[id]/edit/page.tsx` fetched the alert-to-edit by `.eq("id", params.id)` only, relying on RLS alone to stop cross-user access. Added `.eq("user_id", user.id)` to the select, matching the app-side defense-in-depth pattern already used by every other `price_alerts` query in `apps/web/app/dashboard/actions.ts`.
- **Should Fix** — `apps/web/app/dashboard/actions.ts` (`readAlertFormFields`) called `new Date(expirationRaw).toISOString()` before zod validation ran, so an unparseable date string threw an uncaught `RangeError` (raw 500) instead of a friendly validation error. Now checks `Number.isNaN(parsed.getTime())` first (same check `expirationMustBeFuture`'s refine already does); if invalid, the raw string is passed through so `updatePriceAlertSchema`/`createPriceAlertSchema`'s refine rejects it cleanly.
- Verified after fix: `pnpm build`, `pnpm test` (8/8 alert-engine tests pass), `pnpm typecheck` — all green, repo root.

**What was verified locally (no live Supabase project required):**
- `pnpm install` — succeeds, 6 workspace packages linked.
- `pnpm build` — succeeds for all 5 buildable packages (`@tradeflow/types`, `@tradeflow/validation`, `@tradeflow/market-data`, `@tradeflow/alert-engine`, `web`). `web`'s Next.js production build compiles, typechecks, and generates all 9 routes successfully with placeholder env values absent (no `.env.local` exists — Next.js does not require env vars to exist at build time here since they're only read at request time in Server Components/Actions).
- `pnpm test` — all 8 required `evaluatePriceAlert` cases pass (see `packages/alert-engine/src/__tests__/evaluatePriceAlert.test.ts`), named to match the brief's wording verbatim.
- `pnpm typecheck` — clean across all 5 TypeScript packages, strict mode on.
- `npx playwright test --list` (from `apps/web`) — confirms `e2e/alert-crud.spec.ts` parses correctly and registers 1 test, without needing browsers installed or a live server.

**What is BLOCKED pending the owner creating the Supabase project (per the brief's known flag):**
- `pnpm --filter web dev` has not been run against real auth — no `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` exist. No `.env.local` was created; only `apps/web/.env.local.example` with obviously-fake placeholder values.
- The full manual walkthrough (sign up, log in, create/edit/enable/disable/delete an XAUUSD alert) has not been performed.
- The Playwright e2e test (`pnpm test:e2e` in `apps/web`) has not actually been run end-to-end — only confirmed it lists/parses correctly.
- RLS has not been verified manually with two live test users against a real project. The two migrations (`0001_init.sql`, `0002_rls.sql`) were written and reviewed by inspection (every user-owned table has `auth.uid() = user_id`/`id` policies for select/insert/update/delete as applicable; `instruments` has select-only for `authenticated`, no client write policy). Once a project exists, this should be verified by: creating two users A and B via signup, each creating a price_alert, then confirming (a) user A's `select` on `price_alerts` returns only their own row, (b) user A cannot `update`/`delete` user B's row (should return 0 rows affected / a permission-denied-shaped empty result, not an error that leaks existence), and (c) both users can `select` from `instruments`.
- Migrations have not been applied to any live project (there isn't one yet).

Once the owner hands over the Supabase project URL and anon key, the remaining Definition of Done items (live `dev` boot, manual CRUD walkthrough, live RLS check with two users, live Playwright run) can be completed without further code changes — nothing in the codebase is stubbed or fake beyond the missing env values.

---

## Known Gaps
*Logged here instead of fixed. Addressed in a future step.*

- **KG-1** — Live-credential verification (dev server boot, manual RLS check with two users, live Playwright run) is blocked on the owner creating the Supabase project and handing over the URL/anon key. Everything else in Step 1's Definition of Done is done. — logged 2026-08-30
- **KG-2** — No Supabase-generated `Database` type (`supabase gen types typescript`) exists yet; Supabase query results are typed via manual `.returns<T>()` casts against `@tradeflow/types` instead. Should be regenerated from the real schema once the project exists. — logged 2026-08-30
- **KG-3** — `PROJECT_SPEC.txt` is a reconstruction from `handoff/ARCHITECT-BRIEF.md`, not a verified verbatim copy of an original spec document (none was available this session). See open question in `handoff/REVIEW-REQUEST.md`. — logged 2026-08-30
- **KG-4** — `turbo run build` emits `WARNING no output files found for task ...#build` for the 4 `tsc --noEmit`-only packages (types/validation/market-data/alert-engine), because their `build` script never emits files but `turbo.json`'s shared `outputs` config expects `dist/**`. Cosmetic only — build still succeeds and exits 0 — not fixed to avoid scope creep into per-package turbo task configs this step. — logged 2026-08-30

---

## Architecture Decisions
*Locked decisions that cannot be changed without breaking the system.*

- Monorepo: Turborepo + pnpm workspaces; `apps/web` (Next.js App Router) + `packages/{types,validation,market-data,alert-engine}` — 2026-08-30
- `packages/alert-engine`'s `evaluatePriceAlert` is pure and I/O-free; all "don't fire again" state (ONCE mode) is expressed via caller-supplied `last_triggered_at`, never mutated by the engine — 2026-08-30
- `instruments.last_price` / `last_price_at` are the only "previous price" storage for V1 — no separate price-ticks history table — 2026-08-30
- Supabase `auth.users` is the sole identity source of truth; the app never defines its own `users` table — 2026-08-30
