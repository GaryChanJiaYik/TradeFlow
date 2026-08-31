# Review Feedback — Step 4
*Written by Reviewer. Read by Builder and Architect.*

Date: 2026-08-31
Ready for Builder: YES

---

## Must Fix
[Blocks the step. Bob fixes before anything moves forward.]

None.

## Should Fix
[Does not block. Fix inline if under 5 minutes, otherwise log to BUILD-LOG.]

None.

## Escalate to Architect
[Product or business decision required — not a code decision.]

None.

## Cleared

- **Auth guard structure, both new `page.tsx` files** — read
  `apps/web/app/dashboard/alerts/new/page.tsx` and
  `apps/web/app/dashboard/reminders/new/page.tsx` in full (17 lines each,
  no `"use client"` directive — genuine Server Components). Both are:
  `createClient()` → `await supabase.auth.getUser()` → `if (!user)
  redirect("/login")` → render `<main><NewXForm /></main>`. There is no
  code before the check (no early return, no conditional that could skip
  it) and nothing after the guard except the render — `redirect()` throws
  in Next.js, so there is no fall-through path that reaches
  `<NewAlertForm />`/`<NewReminderForm />` without a resolved `user`.
  Confirmed `createClient` (`apps/web/lib/supabase/server.ts`) is the
  cookie-backed server client (`createServerClient` from `@supabase/ssr`
  reading `next/headers` cookies), not the browser client — the same
  primitive the already-correct `alerts/[id]/edit/page.tsx` uses.
  Diffed the new pages against `alerts/[id]/edit/page.tsx`: identical
  shape minus the `.from(...).select(...).eq("id", ...).eq("user_id",
  ...)` fetch and `notFound()` check, which is correctly absent here since
  a "new" page has no record to fetch. Structurally equivalent to the
  proven-correct pattern, not just similar-looking.

- **Form components are pure moves, not rewrites** — diffed
  `new-alert-form.tsx` and `new-reminder-form.tsx` against the previous
  committed `alerts/new/page.tsx` / `reminders/new/page.tsx` bodies
  (`git show HEAD:...`). The only changes in both files: `export default
  function NewXPage()` → `export function NewXForm()`, and the `<main>...
  </main>` wrapper removed (now supplied by the page). Every import,
  `initialState`, `SubmitButton`, `useFormState` call, field, label,
  `name`/`id` attribute, validation attribute (`required`, `min`,
  `maxLength`, etc.), and the `actions`/cancel-link markup is
  character-for-character identical. In `new-reminder-form.tsx`
  specifically, the `useEffect(() => setTimezone(Intl.DateTimeFormat()
  .resolvedOptions().timeZone), [])` browser-timezone-detection hook and
  its preceding comment are present and untouched — confirmed by direct
  diff, not by description alone.

- **Independent grep audit, `"use client"` on `page.tsx`** — ran the grep
  myself (`Grep` tool with glob `page.tsx` over `apps/web/app`, and
  separately `find apps/web/app -name page.tsx | xargs grep -l
  '"use client"'` as a second method) rather than trusting Bob's count.
  Both return exactly two hits: `apps/web/app/login/page.tsx` and
  `apps/web/app/signup/page.tsx`. Read both in full: neither does a
  `getUser()`/auth check, but neither renders anything user-specific or
  privileged — plain email/password forms with no data fetch, calling
  `logInAction`/`signUpAction`. Being reachable while logged out is their
  entire purpose (an already-authenticated user hitting `/login` is a
  UX nicety to handle, not a security gap — no comparison here to
  something that should have redirected). Confirms Bob's claimed audit
  result independently; no other instance of the anti-pattern exists.

- **Live behavioral verification (not just code inspection)** — ran
  `pnpm build` myself against the real `apps/web/.env.local` Supabase
  project: clean build, and the route table shows both
  `/dashboard/alerts/new` and `/dashboard/reminders/new` as `ƒ`
  (dynamic/server-rendered), matching every other authenticated dashboard
  route (`/dashboard`, `/dashboard/alerts/[id]/edit`,
  `/dashboard/reminders/[id]/edit`) — `/login` and `/signup` remain `○`
  (static), consistent with them being genuinely public. Then ran `next
  start` locally and `curl -i` both routes with zero cookies: both
  returned `307 Temporary Redirect` with `Location: /login`, byte-for-byte
  matching the existing correct `/dashboard` baseline I curled alongside
  them for comparison. Grepped the response bodies for form tells
  (`target_price`, `Timeframe`, `New XAUUSD`, `Create alert`, `Create
  reminder`) — zero matches in either response; the body is only the
  standard Next.js redirect/404 shell with a `NEXT_REDIRECT;replace;
  /login;307` digest, no field labels or form markup. This directly
  reproduces Arch's original finding being closed, independently of
  Bob's own account of the same test. Also ran `tsc --noEmit` across the
  workspace myself: exit 0, clean.

- **Scope discipline** — `git status` shows exactly the files described:
  two modified `page.tsx` (now server components) and two new form
  component files, plus the three handoff docs. No unrelated files
  touched, no drift beyond the stated fix.

**Step 4 is clear.** The guard is structurally and behaviorally
equivalent to the already-proven-correct edit-page pattern, the form
extraction is a verified pure move with the timezone-detection effect
intact, the "use client"-on-page.tsx anti-pattern is confirmed fully
eradicated outside the two intentionally-public auth pages, and I
independently reproduced the 307-redirect-with-no-form-content result
against a real local production build on the live Supabase project
rather than relying on Bob's report of the same test.
