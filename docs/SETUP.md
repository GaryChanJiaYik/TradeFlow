# Local Setup

## Prerequisites

- Node.js >= 18.18
- pnpm (this repo pins a version via `packageManager` in `package.json`;
  running any `pnpm` command through `corepack` will use the right one)
- A Supabase project (free tier is enough for local development)

## 1. Install dependencies

```
pnpm install
```

## 2. Create a Supabase project

1. Create a project at https://supabase.com/dashboard.
2. In **Project Settings -> API**, copy the **Project URL** and the
   **anon public** key.
3. In **Authentication -> Providers -> Email**, for local/e2e testing
   convenience, turn **off** "Confirm email" — otherwise a newly signed-up
   user has no active session until they click the confirmation link, and
   `apps/web/e2e/alert-crud.spec.ts` will not be able to log in immediately
   after signing up. (Leave it on for anything resembling production.)
4. In the SQL editor (or via the Supabase CLI), run the migrations in
   `supabase/migrations/` in order: `0001_init.sql`, `0002_rls.sql`, then
   `0003_cron.sql`. The third one enables `pg_cron`/`pg_net` and registers
   the tick schedule, but it cannot actually fire anything useful until the
   `tick` function is deployed and its two Vault secrets exist — see
   step 7 below. Applying it earlier is harmless.

## 3. Configure environment variables

```
cp apps/web/.env.local.example apps/web/.env.local
```

Then fill in these keys in `apps/web/.env.local` (never commit this file —
it's already gitignored):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — for the "Enable notifications" button on
  the dashboard. Generate a real keypair with
  `npx web-push generate-vapid-keys` (see step 7); this must be the same
  public key as the Edge Function's `VAPID_PUBLIC_KEY` secret.

## 4. Run the app

```
pnpm --filter web dev
```

Visit http://localhost:3000, sign up, log in, and create/edit/enable/
disable/delete an XAUUSD alert from the dashboard.

## 5. Run tests

```
pnpm test
```

Runs the alert-engine Vitest suite (no Supabase project needed — it's a
pure function with no I/O).

## 6. Run the end-to-end test

Requires a configured Supabase project as above (with email confirmation
disabled), plus Playwright's browser binaries:

```
cd apps/web
npx playwright install chromium
pnpm test:e2e
```

This starts the dev server automatically and runs
`e2e/alert-crud.spec.ts` (sign up, log in, create an alert, see it listed,
edit it, delete it).

## 7. Web Push: generate a VAPID keypair

Web Push notifications are signed with a VAPID keypair — a plain local
keypair, no external account or signup needed:

```
npx web-push generate-vapid-keys
```

This prints a public and private key. Put them in:

- `apps/web/.env.local`: `NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key>`
- The Edge Function's env (see step 8 for local, or `supabase secrets set`
  for a deployed project): `VAPID_PUBLIC_KEY=<same public key>`,
  `VAPID_PRIVATE_KEY=<private key>`, `VAPID_SUBJECT=mailto:<contact address>`

`VAPID_SUBJECT` should be a real `mailto:` address push services can use to
contact you about your server if it misbehaves — not documented as a fixed
value here yet; see the open question in `handoff/REVIEW-REQUEST.md`.

Once both env vars are wired up, the dashboard's "Enable notifications"
button will register the service worker (`apps/web/public/sw.js`), ask for
permission, subscribe, and persist the subscription to `devices` for the
signed-in user — this works against a normal `pnpm --filter web dev`, no
Edge Function or OANDA needed.

## 8. Run the "tick" Edge Function locally

`supabase/functions/tick` is a Deno Edge Function invoked by pg_cron every
2 minutes in production. To run and test it locally, you need Docker
Desktop running (the Supabase CLI's local stack and Edge Function runtime
are both Docker containers) plus the Supabase CLI and Deno:

```
npx supabase@latest start   # spins up a full local Postgres/Auth/etc. stack
```

Set up the function's local secrets:

```
cp supabase/functions/.env.local.example supabase/functions/.env.local
```

Fill in fake-but-well-formed `OANDA_API_TOKEN`/`OANDA_ACCOUNT_ID` (a real
token isn't needed for local logic verification — see below) and your real
generated VAPID values from step 7.

**A note on `supabase functions serve` on Windows:** at the time of
writing, the CLI's Docker-based file-mounting for `supabase functions
serve` does not reliably follow this function's relative-path imports into
`packages/*` more than one level deep on Windows + Docker Desktop (it
throws `Module not found` for files it never bind-mounted into the
container, even though the same imports type-check and run correctly
through plain Deno). If you hit this, verify with local Deno directly
instead — it exercises the exact same source files and import map, just
without that container's file-mounting step:

```
# Type-check only:
deno check --config supabase/functions/deno.json supabase/functions/tick/index.ts

# Run it (needs the local stack's URL/service-role key from
# `npx supabase@latest status`, plus your OANDA/VAPID values):
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<from `supabase status`> \
OANDA_API_TOKEN=... OANDA_ACCOUNT_ID=... OANDA_ENV=practice \
VAPID_SUBJECT=... VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
deno run --allow-net --allow-env --config supabase/functions/deno.json supabase/functions/tick/index.ts
```

This starts an HTTP listener (default `http://localhost:8000`) you can
`curl -X POST` directly. See `handoff/BUILD-LOG.md` for the exact local
verification steps this session ran (seeding a test user/alert/reminder,
mocking OANDA's response, and confirming the DB updates end-to-end).

When you're done, tear the stack down:

```
npx supabase@latest stop
```

## 9. Cloudflare deploy (build-ready, not actually deployed)

`apps/web` is configured for Cloudflare Workers via the OpenNext adapter
(`@opennextjs/cloudflare`, `apps/web/wrangler.jsonc`,
`apps/web/open-next.config.ts`) — see the open question in
`handoff/REVIEW-REQUEST.md` about Workers vs. classic Cloudflare Pages.
No deploy has been run; this repo does not assume you have a Cloudflare
account. If/when one is confirmed:

```
cd apps/web
pnpm cf:preview   # builds and runs a local Cloudflare Workers preview
pnpm cf:deploy    # builds and deploys — requires `wrangler login` first
```
