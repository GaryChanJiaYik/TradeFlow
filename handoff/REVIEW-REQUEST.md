# Review Request — Step 4: Fix unauthenticated access to "new alert"/"new reminder" pages
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## Context

Arch found this by curling the live production deployment: `/dashboard/alerts/new`
and `/dashboard/reminders/new` served their full create-form HTML to completely
unauthenticated requests (200, real form field labels in the body), while every
other dashboard page correctly redirects unauthenticated visitors to `/login`. This
is a fix to already-shipped, already-twice-reviewed code — per Arch's flag in
`handoff/ARCHITECT-BRIEF.md`, treat this with the same rigor as a new security
finding, not a rubber-stamp. Full root-cause writeup: `handoff/ARCHITECT-BRIEF.md`'s
Step 4 section. Builder Plan (written and left in place per BUILDER.md, since this
was a background run): `handoff/ARCHITECT-BRIEF.md`'s Builder Plan section. Full
detail of what was verified: `handoff/BUILD-LOG.md`'s new "Step 4" entry.

Scope note carried over from the brief: this was an access-control/consistency gap,
not a data leak or a way to create data without an account — `createAlertAction`/
`createReminderAction` already independently derive `user.id` from the session and
would reject/no-op for an unauthenticated request. The bug was that the form *screen*
rendered at all for a logged-out visitor.

This session had full live access to the real Supabase project — no blockers.

## What Was Changed

Both changes follow the identical pattern, matching what `alerts/[id]/edit/page.tsx`
and `reminders/[id]/edit/page.tsx` already did correctly.

### Alerts
- **`apps/web/app/dashboard/alerts/new/new-alert-form.tsx`** (new, 82 lines) — the
  exact former body of `alerts/new/page.tsx`: imports, `initialState`,
  `SubmitButton`, the `useFormState` hook, and the full form JSX. Only change: the
  default export `NewAlertPage` became a named export `NewAlertForm`, and the
  `<main>` wrapper was removed (now supplied by the page). No field, validation, or
  behavior changes.
- **`apps/web/app/dashboard/alerts/new/page.tsx`** (rewritten, 82 → 17 lines) — now
  an async server component: `createClient()`, `getUser()`, `redirect("/login")` if
  no user, then `<main><NewAlertForm /></main>`. No record fetch (nothing to fetch
  for "new"). Structurally near-identical to `alerts/[id]/edit/page.tsx` minus the
  fetch.

### Reminders
- **`apps/web/app/dashboard/reminders/new/new-reminder-form.tsx`** (new, 80 lines) —
  same treatment: former `reminders/new/page.tsx` body moved verbatim, default
  export renamed to `NewReminderForm`. The browser-timezone-detection `useEffect`
  (defaults the timezone field post-mount to avoid a hydration mismatch) is
  untouched.
- **`apps/web/app/dashboard/reminders/new/page.tsx`** (rewritten, 81 → 17 lines) —
  same server-guard pattern, renders `<NewReminderForm />`.

### Audit (brief's build-order step 3)
Grepped `apps/web/app/**/page.tsx` for `^"use client"`. Before the fix: 4 hits
(`alerts/new`, `reminders/new`, `login`, `signup`). After: 2 hits remain —
`app/login/page.tsx` and `app/signup/page.tsx`, both intentionally public,
unauthenticated-by-design pages (that is their entire purpose). No other instance
of the anti-pattern exists in the app.

No other files touched. `handoff/ARCHITECT-BRIEF.md`'s Builder Plan section was
added per BUILDER.md's process (plan-then-build, background run).

## Verified

- `pnpm build`, `pnpm test`, `pnpm typecheck` at repo root — all green, no test
  changes (this is a routing/auth structure fix, not business logic), 23 tests
  unchanged. `pnpm build`'s route table shows both `/dashboard/alerts/new` and
  `/dashboard/reminders/new` now built as `ƒ` (dynamic/server-rendered) instead of
  their previous client-only shape.
- **Unauthenticated redirect — local production build**: ran `pnpm build` +
  `pnpm start` (real production build using `apps/web/.env.local`'s real Supabase
  project) and `curl -i` both routes with no cookies. Before the fix: `200` with
  full form HTML. After the fix: both return `307 Temporary Redirect` with
  `Location: /login`, matching `/dashboard`'s existing behavior byte-for-byte — the
  body is the standard Next.js redirect shell, no form content, no field labels.
  This directly reproduces and closes Arch's reported finding (checked locally, not
  against the live Cloudflare URL — see "Not Attempted" below).
- **Authenticated create/edit/delete flows — live Supabase project**: ran the
  repo's existing Playwright specs, unmodified, from Step 3 —
  `apps/web/e2e/alert-crud.spec.ts` and `reminder-crud.spec.ts` — against the live
  project. Both pass. Each signs up a fresh real user, clicks through to the "new"
  page (now server-guarded), creates, edits, and deletes a real row. This confirms
  the split didn't regress the authenticated path.

## Not Attempted

- No live `curl` against the actual deployed Cloudflare URL
  (`tradeflow-web.garychanjiayik.workers.dev`) — this session has no
  `wrangler login`/deploy credentials, same constraint as Step 3. Per
  `handoff/BUILD-LOG.md`'s "Pending deploy," Arch redeploys after review clears;
  until then the live site still has this bug. Local `pnpm build` + `pnpm start`
  against the same env config is the closest available proxy, and is what the
  brief's Definition of Done asks for ("against the deployed app or a local
  build").

## Known Gaps Logged

- **KG-10** (`handoff/BUILD-LOG.md`) — two more test users
  (`e2e-<timestamp>@example.com`, `e2e-reminder-<timestamp>@example.com`) created
  in the real Supabase project by re-running the Step 3 Playwright specs to verify
  this fix. Same shape as KG-6/KG-9: harmless, `auth.users` rows only, no
  service-role key to clean up.
- **KG-11** (`handoff/BUILD-LOG.md`) — the fix is not yet live in production;
  tracked as a pending-deploy item alongside Step 3.

Ready for Review: YES
