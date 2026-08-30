# Review Feedback — Step 1
*Written by Reviewer. Read by Builder and Architect.*

Date: 2026-08-30
Ready for Builder: YES

---

## Must Fix
*Blocks the step. Builder fixes before anything moves forward.*

- `apps/web/app/dashboard/alerts/[id]/edit/page.tsx:15-19` — The edit-page fetch queries `price_alerts` filtered only by `.eq("id", params.id)` — it never adds `.eq("user_id", user.id)`. Every other read/write path in this step (`apps/web/app/dashboard/actions.ts`: create scopes via the session's `user.id`, update/setAlertEnabled/delete all add `.eq("user_id", user.id)`) enforces app-side scoping in addition to RLS. This one query relies on RLS alone to stop User A from loading User B's alert by guessing/enumerating its id. RLS in `0002_rls.sql` does currently block this (so there's no live data leak today), but it's the one place in the codebase that breaks the defense-in-depth pattern used everywhere else — if that policy is ever weakened, disabled for a migration, or a service-role client is substituted here later, this becomes a live cross-user data leak with no second gate. Fix: add `.eq("user_id", user.id)` to the select, matching the pattern already used in every other query against `price_alerts`.

## Should Fix
*Does not block. Fix inline if under 5 minutes, otherwise log to BUILD-LOG.*

- `apps/web/app/dashboard/actions.ts:36-42` (`readAlertFormFields`) — `new Date(expirationRaw).toISOString()` runs before the value ever reaches `updatePriceAlertSchema`/`createPriceAlertSchema`. If `expirationRaw` doesn't parse to a valid date (e.g. a hand-crafted POST that bypasses the `datetime-local` input's format guarantee — trivial since these are plain server actions), `Invalid Date.toISOString()` throws an uncaught `RangeError` and the action fails with a raw 500 instead of the friendly zod validation message the schema is designed to produce. Recommend checking `Number.isNaN(parsed.getTime())` (same check the zod `expirationMustBeFuture` refine already does) before calling `.toISOString()`, and passing the raw string through to let the schema's refine reject it cleanly if invalid.

## Escalate to Architect
*Product or business decision required.*

(None — Bob's existing Open Questions in `handoff/REVIEW-REQUEST.md` (spec provenance, `handle_new_user` trigger, no generated `Database` type, extensionless imports, unpinned versions) are all reasonable engineering calls for Step 1 and don't need a product decision from me. No new escalation-worthy issue found in the reviewed files.)

## Cleared

- `packages/alert-engine/src/evaluatePriceAlert.ts` + `__tests__/evaluatePriceAlert.test.ts` — crossing logic is genuinely `previous < target && current >= target` (CROSS_UP) / `previous > target && current <= target` (CROSS_DOWN) / either (CROSS_BOTH), never a bare `current >= target` check; ONCE (fires only when `last_triggered_at` is null), EVERY_TIME (fires on every genuine new crossing), expiration (`expiration_at <= now` blocks), and disabled (`enabled === false` blocks) are all handled correctly and checked in a sane order (enabled → expiration → crossing → trigger-mode). All 8 required test cases are present, use realistic price sequences rather than trivial/tautological assertions, and would genuinely fail against a naive bare-threshold implementation (verified by hand-tracing the "CROSS_UP does NOT trigger without crossing" and "CROSS_DOWN does NOT trigger without crossing" cases against such a broken implementation).
- `supabase/migrations/0002_rls.sql` — every user-owned table (`price_alerts`, `graph_reminders`, `devices` — full select/insert/update/delete scoped to `auth.uid() = user_id`; `profiles` — select/update scoped to `auth.uid() = id`, insert/delete intentionally omitted per the documented `handle_new_user` trigger design; `notification_log` — select-only, scoped, service-role writes only) is correctly restricted, and `instruments` has a select-only policy for authenticated users with no client write policy of any kind.
- `packages/validation/src/priceAlert.ts` — `target_price` is genuinely enforced `> 0` via zod `.positive()` (not just a type), and `expiration_at` is genuinely enforced future-only via a real `Date`/`Date.now()` comparison in `expirationMustBeFuture` (not a decorative refine that always passes); confirmed both schemas are actually invoked via `safeParse` before every insert/update in `apps/web/app/dashboard/actions.ts`, with the parsed/validated output (not raw form input) passed to Supabase.
- `apps/web/app/dashboard/actions.ts` — `createAlertAction`, `updateAlertAction`, `setAlertEnabledAction`, and `deleteAlertAction` all derive `user.id` from `supabase.auth.getUser()` (never from client-supplied form data) and add it as an explicit `.eq("user_id", user.id)` filter/insert value on every mutation, giving real defense-in-depth beyond RLS for writes (the one gap is the edit-page read, above).
- `apps/web/.env.local.example` / `.gitignore` — the example file contains only obviously-fake placeholder values (`your-project-ref`, `your-anon-key-here`); `.gitignore` excludes `.env`, `.env.local`, and `.env.*.local`.

---

# Round 2 — Re-Review
Date: 2026-08-30
Ready for Builder: NO — no new feedback, no further Builder action needed on Step 1.

Scope: re-reviewed only the two files Bob listed in `handoff/REVIEW-REQUEST.md`'s "Round 2 — Review Feedback Addressed" section, against the two findings below. Rest of Step 1 stays out of scope (already cleared Round 1).

## Must Fix
None.

- **Was:** `apps/web/app/dashboard/alerts/[id]/edit/page.tsx:15-19` — edit-page fetch missing `.eq("user_id", user.id)`.
- **Now:** Line 16-21 reads `.from("price_alerts").select("*").eq("id", params.id).eq("user_id", user.id).maybeSingle<PriceAlert>()`. `user.id` is the same variable destructured from `supabase.auth.getUser()` two lines above, already guarded by `if (!user) redirect("/login")`. Matches the app-side scoping pattern used everywhere else in `actions.ts`. **Confirmed fixed.**

## Should Fix
None.

- **Was:** `apps/web/app/dashboard/actions.ts` `readAlertFormFields` calling `.toISOString()` on a possibly-invalid `Date` ahead of zod validation, throwing an uncaught `RangeError` on a hand-crafted invalid `expiration_at`.
- **Now:** the field is computed as `Number.isNaN(parsed.getTime()) ? expirationRaw : parsed.toISOString()` — an unparseable value is passed through as the raw string instead of calling `.toISOString()` on it. Traced this into `packages/validation/src/priceAlert.ts`: `expirationAtSchema` types the field as plain `z.union([z.string(), z.null()]).optional()`, so an invalid-but-still-a-string value passes the type check without issue, and only fails at `.refine(expirationMustBeFuture, ...)`, whose own `new Date(val)` / `Number.isNaN` check rejects it with the clean message "expiration_at must be a valid date in the future". Nothing upstream of the refine re-throws on the raw string. **Confirmed fixed** — no more uncaught `RangeError`/500 on this path.

## Escalate to Architect
None.

## Cleared
- Both Round 1 findings on `apps/web/app/dashboard/alerts/[id]/edit/page.tsx` and `apps/web/app/dashboard/actions.ts` are verified resolved, not just present. **Step 1 is clear.** No further Builder action needed.
