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
   `supabase/migrations/` in order: `0001_init.sql`, then `0002_rls.sql`.

## 3. Configure environment variables

```
cp apps/web/.env.local.example apps/web/.env.local
```

Then fill in these two keys in `apps/web/.env.local` (never commit this
file — it's already gitignored):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

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
