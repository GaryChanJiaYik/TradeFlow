# Review Request — Step 1
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## Round 2 — Review Feedback Addressed (2026-08-30)

Both findings from `handoff/REVIEW-FEEDBACK.md` (2026-08-30, first pass) are fixed:

- **Must Fix** — `apps/web/app/dashboard/alerts/[id]/edit/page.tsx:16-20` — added `.eq("user_id", user.id)` to the `price_alerts` select alongside `.eq("id", params.id)`, matching the app-side scoping pattern used by every other `price_alerts` query in `apps/web/app/dashboard/actions.ts`. Closes the gap where this one read relied on RLS alone.
- **Should Fix** — `apps/web/app/dashboard/actions.ts:34-51` (`readAlertFormFields`) — now checks `Number.isNaN(parsed.getTime())` before calling `.toISOString()` on the parsed expiration date; an unparseable string is passed through raw so the zod schema's `expirationMustBeFuture` refine rejects it with a friendly validation error instead of the action throwing an uncaught `RangeError`.

No other files touched — scope-locked to these two fixes per Richard's feedback.

Verification (repo root, after fix): `pnpm build`, `pnpm test`, `pnpm typecheck` all pass. See `handoff/BUILD-LOG.md` "Review Fixes" entry for details.

**Ready for Review: YES**

---

## What Was Built

A Turborepo + pnpm monorepo for TradeFlow: four TypeScript packages
(`types`, `validation`, `market-data`, `alert-engine`), a Next.js App Router
web app with Supabase-backed auth and full price-alert CRUD against a
single seeded XAUUSD instrument, two SQL migrations (schema + RLS), a
Playwright e2e spec, and the required top-level docs. Everything that does
not require a live Supabase project has been built and verified locally
(`pnpm install`, `pnpm build`, `pnpm test`, `pnpm typecheck` all pass — see
`handoff/BUILD-LOG.md` for exact commands/output). The final
live-credential verification steps (dev server boot, manual CRUD
walkthrough, two-user RLS check, live Playwright run) are blocked on the
owner creating the Supabase project — see Known Gaps.

## Files Changed

| File | Lines | Change |
|---|---|---|
| `package.json` | 1-21 | Root workspace manifest: pnpm workspaces, turbo scripts, pinned `packageManager`. |
| `pnpm-workspace.yaml` | 1-3 | Declares `apps/*` and `packages/*` as workspace packages. |
| `turbo.json` | 1-24 | Turborepo pipeline: build/dev/test/lint/typecheck tasks with cache outputs. |
| `tsconfig.base.json` | 1-18 | Shared strict TS compiler options extended by every package. |
| `.gitignore` | 1-45 | Excludes node_modules/.next/.turbo/.env.local and local agent-tooling dirs (`.claude/`, `.token-optimizer/`, `_temp/`) that predate this step and aren't project content. |
| `.editorconfig` | 1-12 | Consistent indentation/line-ending rules across editors. |
| `packages/types/src/enums.ts` | 1-18 | Literal-union enum types mirroring the DB CHECK constraints. |
| `packages/types/src/instrument.ts` | 1-17 | `Instrument` type matching the `instruments` table. |
| `packages/types/src/priceAlert.ts` | 1-19 | `PriceAlert` type matching the `price_alerts` table. |
| `packages/types/src/graphReminder.ts` | 1-17 | `GraphReminder` type matching the `graph_reminders` table. |
| `packages/types/src/device.ts` | 1-30 | `Device` type + `WebPushSubscriptionJson` shape for the `subscription` JSONB column. |
| `packages/types/src/notificationLog.ts` | 1-16 | `NotificationLog` type matching the `notification_log` table. |
| `packages/types/src/priceUpdate.ts` | 1-11 | `PriceUpdate` tick shape consumed by the alert engine and market-data provider. |
| `packages/types/src/index.ts` | 1-7 | Barrel export for the package. |
| `packages/types/package.json`, `tsconfig.json` | — | Package manifest/TS config. |
| `packages/validation/src/enums.ts` | 1-13 | zod mirrors of the direction/trigger_mode/timeframe enums. |
| `packages/validation/src/priceAlert.ts` | 1-54 | `createPriceAlertSchema` / `updatePriceAlertSchema`: `target_price > 0`, `expiration_at` must be future-or-null, enum validation. |
| `packages/validation/src/auth.ts` | 1-20 | Signup/login form schemas (email format, min password length). |
| `packages/validation/src/index.ts` | 1-3 | Barrel export. |
| `packages/validation/package.json`, `tsconfig.json` | — | Package manifest/TS config. |
| `packages/market-data/src/provider.ts` | 1-13 | `MarketDataProvider` interface only — no concrete implementation, per the brief's flag. |
| `packages/market-data/src/index.ts`, `package.json`, `tsconfig.json` | — | Barrel export + package manifest/TS config. |
| `packages/alert-engine/src/evaluatePriceAlert.ts` | 1-67 | The pure, I/O-free crossing-evaluation function — implements CROSS_UP/CROSS_DOWN/CROSS_BOTH, ONCE/EVERY_TIME, expiration, and disabled-alert rules exactly as specified. |
| `packages/alert-engine/src/__tests__/evaluatePriceAlert.test.ts` | 1-86 | The 8 required Vitest cases, named to match the brief's wording; all pass. |
| `packages/alert-engine/src/index.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts` | — | Barrel export, package manifest, TS config, Vitest config. |
| `supabase/migrations/0001_init.sql` | 1-168 | Schema: `profiles`, `instruments` (seeded with one XAUUSD row), `price_alerts`, `graph_reminders`, `devices`, `notification_log`; `updated_at` trigger helper; a `handle_new_user` trigger auto-provisioning a `profiles` row on signup (see Open Questions). |
| `supabase/migrations/0002_rls.sql` | 1-128 | RLS: `auth.uid() = user_id`/`id` policies on every user-owned table; `instruments` readable by any authenticated user, no client write policy (service-role only, unused until Step 2). |
| `apps/web/package.json`, `tsconfig.json`, `next.config.mjs`, `next-env.d.ts` | — | Next.js app manifest/config; `transpilePackages` for the workspace packages. |
| `apps/web/middleware.ts`, `lib/supabase/middleware.ts` | 1-19, 1-40 | Refreshes the Supabase session cookie on every request (standard `@supabase/ssr` pattern). |
| `apps/web/lib/supabase/client.ts` | 1-12 | Browser Supabase client factory. |
| `apps/web/lib/supabase/server.ts` | 1-36 | Server Supabase client factory for Server Components/Actions. |
| `apps/web/app/layout.tsx`, `globals.css` | 1-15, 1-159 | Root layout + minimal shared styling (no design system pulled in). |
| `apps/web/app/page.tsx` | 1-31 | Landing page: redirects to `/dashboard` if already signed in, else links to login/signup. |
| `apps/web/app/login/page.tsx` | 1-49 | Login form (client component, `useFormState`). |
| `apps/web/app/signup/page.tsx` | 1-51 | Signup form; shows a "check your email" notice if email confirmation is enabled on the project. |
| `apps/web/app/auth/actions.ts` | 1-73 | Server actions: `signUpAction`, `logInAction`, `logOutAction`. |
| `apps/web/app/auth/callback/route.ts` | 1-23 | Exchanges the Supabase email-confirmation code for a session. |
| `apps/web/app/dashboard/page.tsx` | 1-115 | Alert list: table with instrument/target/direction/mode/expiry/status, Edit link, Enable/Disable and Delete forms, sign-out. |
| `apps/web/app/dashboard/actions.ts` | 1-149 | Server actions: `createAlertAction`, `updateAlertAction`, `setAlertEnabledAction`, `deleteAlertAction` — all validated via `@tradeflow/validation`, all scoped to the current user. |
| `apps/web/app/dashboard/alerts/new/page.tsx` | 1-82 | Create-alert form. |
| `apps/web/app/dashboard/alerts/[id]/edit/page.tsx` | 1-31 | Server component: fetches the alert by id (RLS-scoped) and renders the edit form. |
| `apps/web/app/dashboard/alerts/[id]/edit/edit-form.tsx` | 1-97 | Client edit form, pre-filled, bound to `updateAlertAction`. |
| `apps/web/.env.local.example` | 1-7 | Documents the two required env var names with obviously-fake placeholder values; never a real-looking secret. |
| `apps/web/playwright.config.ts` | 1-26 | Playwright config: single chromium project, auto-starts `pnpm dev`. |
| `apps/web/e2e/alert-crud.spec.ts` | 1-56 | Signup → logout → login → create → edit → delete flow for one alert. |
| `PROJECT_SPEC.txt` | 1-170 | Reconstructed project spec (see Open Questions — not a verified verbatim original). |
| `README.md` | 1-66 | Repo overview + COST/FREE TIER section for Supabase. |
| `AGENTS.md` | 1-13 | Pointer doc: read `PROJECT_SPEC.txt`, then the relevant role file. |
| `docs/SETUP.md` | 1-72 | Local setup steps, including the "disable Confirm email" note needed for the e2e test to work. |
| `handoff/BUILD-LOG.md`, `handoff/ARCHITECT-BRIEF.md` (Builder Plan section) | — | Step-1 log entry and the pre-build plan Arch approved implicitly per this run's instructions. |

## Open Questions

1. **`PROJECT_SPEC.txt` provenance** — I did not have the owner's original verbatim spec text in this session, per Arch's instructions. I reconstructed it from everything `handoff/ARCHITECT-BRIEF.md` states about the product, schema, alert-engine semantics, and UI scope. I'm reasonably confident it's complete relative to what this step needed, but it is **not verified against an original document**. If one exists, please supply it and I'll replace this file verbatim.
2. **`handle_new_user` trigger on `auth.users`** (`supabase/migrations/0001_init.sql`) — the brief specifies the `profiles` table but doesn't say how rows get into it. Without some mechanism, `profiles` would stay permanently empty. I added a `security definer` trigger that inserts a `profiles` row whenever a new `auth.users` row is created. This is standard Supabase practice, but it's a decision I made without explicit instruction — flagging in case Arch wants it handled differently (e.g. explicit app-side insert instead of a DB trigger).
3. **No generated Supabase `Database` type** — query results from `apps/web` are typed via manual `.returns<T>()` casts against `@tradeflow/types`, since `supabase gen types typescript` needs a live project to introspect. Once the project exists this should probably be regenerated and swapped in; logged as KG-2 in BUILD-LOG.
4. **Internal package imports use extensionless specifiers** (e.g. `./enums` not `./enums.js`) rather than the more common Node-ESM `.js`-suffixed style — this was required to get Next.js's webpack bundler to resolve `@tradeflow/*` workspace packages (consumed as raw TS via `transpilePackages`, not pre-built `dist/`). Confirmed working via a full `pnpm build`. Flagging as a stack-level pattern worth keeping consistent going forward, not something to "fix" back to `.js` extensions.
5. **Versions not pinned by the brief** (pnpm 9.12.3, Next.js ^14.2.15, @supabase/ssr ^0.5.2, @supabase/supabase-js ^2.45.4, zod ^3.23.8, Vitest ^2.1.4, @playwright/test ^1.48.0, React 18.3.1) were chosen as current-stable at build time; happy to bump if Arch has different preferences.

## Known Gaps Logged

See `handoff/BUILD-LOG.md` "Known Gaps" for the full list (KG-1 through KG-4). Summary:
- **KG-1** — Live-credential verification (dev boot, manual CRUD walkthrough, two-user RLS check, live Playwright run) blocked on the owner creating the Supabase project.
- **KG-2** — No Supabase-generated `Database` type yet (needs a live project).
- **KG-3** — `PROJECT_SPEC.txt` is a reconstruction, not a verified original (see Open Question 1).
- **KG-4** — Cosmetic `turbo run build` warning about missing outputs for `tsc --noEmit`-only packages; build still exits 0.
