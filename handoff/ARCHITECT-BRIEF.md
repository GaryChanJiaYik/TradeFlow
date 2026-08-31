# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 4 — Fix: unauthenticated access to "new alert" / "new reminder" pages

Found while spot-checking the live deployment after Step 3: `curl`ing
`https://tradeflow-web.garychanjiayik.workers.dev/dashboard/alerts/new` and
`/dashboard/reminders/new` **without any auth cookie** returns HTTP 200 with the full
create form rendered (confirmed by grepping the response for form field labels like
"Timeframe"/"Direction"). Compare to `/dashboard` and `/dashboard/reminders` (the list
pages), which correctly return a 307 redirect to `/login` when unauthenticated.

Root cause: `apps/web/app/dashboard/alerts/new/page.tsx` and
`apps/web/app/dashboard/reminders/new/page.tsx` are `"use client"` components with no
server-side auth check at all — unlike every other page in the app, which is a server
component that calls `supabase.auth.getUser()` and `redirect("/login")` before
rendering anything (see `apps/web/app/dashboard/page.tsx` and the edit pages,
`alerts/[id]/edit/page.tsx` / `reminders/[id]/edit/page.tsx`, for the correct
pattern already used elsewhere). The "new" pages skip this because the whole page
needs to be a client component for `useFormState`, and whoever wrote the first one
(Step 1) put the client directive directly on `page.tsx` instead of splitting it the
way the edit pages already do.

**Practical impact, so this is scoped correctly**: an anonymous visitor can view these
two form screens, but cannot actually create anything — `createAlertAction` and
`createReminderAction` (the server actions) both independently derive `user.id` from
the session and would reject/no-op for an unauthenticated request (confirmed already
reviewed clear in Steps 1 and 3). This is an authorization/access-control gap (internal
app UI shouldn't render for logged-out visitors at all) and an inconsistency with the
rest of the app's defense-in-depth posture — not a data leak or a way to create data
without an account.

### Decisions

- **Fix pattern**: match what the edit pages already do correctly. Split each `new`
  page into two files:
  - `page.tsx` becomes a plain **server component**: `createClient()`, `getUser()`,
    `redirect("/login")` if no user, then renders the client form component. No other
    logic — this file should look almost identical to `alerts/[id]/edit/page.tsx`
    minus the record fetch (there's no existing record for a "new" page).
  - The existing client component content (the `"use client"` form, `useFormState`,
    etc.) moves as-is into a new sibling file — `new-alert-form.tsx` /
    `new-reminder-form.tsx` (matching the existing `edit-form.tsx` naming convention),
    exported as `NewAlertForm` / `NewReminderForm`, imported and rendered by the new
    `page.tsx`.
  - Do not change any form behavior, field logic, or the reminder page's
    browser-timezone-detection `useEffect` — this is purely moving the same client
    component behind a server-side auth guard, not a rewrite.
- **Verify the fix doesn't just move the problem**: after the split, `curl`ing both
  routes with no auth cookie must return a redirect (307) to `/login`, matching the
  list pages' behavior — check this for real against the deployed app or a local
  build, not just by reading the code.
- **Audit for any other instance of this pattern**: grep `apps/web/app` for
  `"use client"` at the top of any `page.tsx` file (not a component file) — if any
  other page has the same shape (client directive directly on the page file, no
  auth check), flag it as an open question rather than silently fixing or silently
  ignoring it; this brief only prescribes the fix for the two known instances.

### Build Order
1. Split `alerts/new/page.tsx` → `alerts/new/page.tsx` (server, auth-gated) +
   `alerts/new/new-alert-form.tsx` (client, existing form content).
2. Split `reminders/new/page.tsx` → `reminders/new/page.tsx` (server, auth-gated) +
   `reminders/new/new-reminder-form.tsx` (client, existing form content).
3. Grep the rest of `apps/web/app` for the same anti-pattern; report findings even if
   none are found.
4. Verify both fixed routes redirect when unauthenticated, and still work correctly
   end-to-end when authenticated (create an alert and a reminder for real against the
   live Supabase project, same as Steps 1 and 3 did).

### Flags
- Flag: This is a fix to already-shipped, already-twice-reviewed code — Richard should
  treat this with the same rigor as a new security finding, not a rubber-stamp.
- Flag: Do not add authentication logic to the client form components themselves
  (e.g. client-side redirect-if-no-session) — the server-component guard is the
  correct, sufficient fix, matching the pattern the edit pages already use. Client-side
  auth checks are not a real access control (a user can just disable JS / hit the API
  directly), so don't treat this as belonging there.

### Definition of Done
- [ ] `pnpm build`, `pnpm test`, `pnpm typecheck` pass at repo root — no test changes
      expected here (this isn't unit-testable business logic, it's a routing/auth
      structure fix), but nothing should break.
- [ ] Unauthenticated `curl` to both `/dashboard/alerts/new` and
      `/dashboard/reminders/new` returns a redirect, not 200 with form content.
- [ ] Authenticated create-alert and create-reminder flows still work, verified live.
- [ ] Grep audit for the same anti-pattern elsewhere in `apps/web/app` reported,
      whether or not anything else was found.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

Confirmed root cause by reading both files: `alerts/new/page.tsx` and
`reminders/new/page.tsx` are `"use client"` default-export page components with
`useFormState` directly in them — no `createClient()` / `getUser()` / `redirect`
anywhere, unlike `alerts/[id]/edit/page.tsx` and `reminders/[id]/edit/page.tsx`
which are async server components that guard with `if (!user) redirect("/login")`
before rendering `<EditAlertForm>` / `<EditReminderForm>`.

Plan (matches the brief's build order exactly, no deviation):
1. `alerts/new/new-alert-form.tsx` — new file, client component. Move the entire
   current body of `alerts/new/page.tsx` in verbatim (imports, `initialState`,
   `SubmitButton`, form JSX), rename the export from `NewAlertPage` (default) to
   `export function NewAlertForm()`. No logic changes.
2. `alerts/new/page.tsx` — replace with an async server component mirroring
   `alerts/[id]/edit/page.tsx`: `createClient()`, `getUser()`, `redirect("/login")`
   if no user, then `<main><NewAlertForm /></main>`. No record fetch (nothing to
   fetch for "new").
3. Same split for `reminders/new/page.tsx` → `reminders/new/new-reminder-form.tsx`
   (`export function NewReminderForm()`, keeping the `useEffect` timezone-detection
   logic untouched) + a server-guarded `reminders/new/page.tsx`.
4. Grep audit `apps/web/app/**/page.tsx` for `^"use client"` — already ran this:
   hits are `reminders/new/page.tsx`, `alerts/new/page.tsx` (the two being fixed),
   plus `signup/page.tsx` and `login/page.tsx`. The latter two are intentionally
   public unauthenticated pages (that's their entire purpose), so they are not
   instances of this anti-pattern — no other page matches. Will state this
   explicitly in BUILD-LOG rather than silently dropping it.
5. Verify: `pnpm build` at repo root; unauthenticated `curl -i` against both
   routes (locally via `next start`, since I don't have a way to redeploy the
   live Cloudflare Worker from here) confirming 307 → `/login`; then sign in
   against the real Supabase project using `apps/web/.env.local` and exercise
   both authenticated create flows end-to-end (create one real alert, one real
   reminder), same verification style as Steps 1/3.
6. Run `pnpm test` / `pnpm typecheck` at repo root.

No open decisions — the brief's fix pattern is unambiguous and the audit is
already done above. Proceeding directly (background run per instruction).

Architect approval: [ ] Approved / [ ] Redirect — see notes below
