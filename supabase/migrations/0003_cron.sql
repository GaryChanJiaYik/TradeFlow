-- TradeFlow — Step 2: pg_cron schedule for the "tick" Edge Function.
-- See handoff/ARCHITECT-BRIEF.md ("Step 2 — Decisions") and
-- handoff/BUILD-LOG.md for the full verification story.
--
-- This CANNOT actually run yet. Two owner/Arch-side, dashboard/CLI-only
-- prerequisites are outside this session's access and are NOT performed
-- here:
--   (a) the `tick` function must be deployed (`supabase functions deploy
--       tick` against the linked project), and
--   (b) the `pg_cron` and `pg_net` extensions must be enabled for this
--       project (Database -> Extensions in the Supabase dashboard, or the
--       `create extension` calls below run once by someone with owner
--       access — this migration includes them as `if not exists` so it is
--       idempotent and safe to apply once that's approved, but applying
--       the migration alone does not equal "extensions enabled" if the
--       project's Postgres role running migrations lacks the privilege;
--       confirm in the dashboard after applying).
-- Applying this migration before the function is deployed is harmless on
-- its own — the schedule will just get HTTP 404s from `net.http_post`
-- until deployment happens; it will not silently corrupt anything.
--
-- Verified LOCALLY (throwaway `supabase start` Docker stack only, per
-- handoff/BUILD-LOG.md): `pg_cron`, `pg_net`, and `supabase_vault` extensions
-- installed cleanly, `cron.schedule(...)` registered the job, and a manual
-- `net.http_post` call using vault-stored secrets round-tripped
-- successfully against the locally-served `tick` function. Never run
-- against the real project, and no real project URL/service-role key was
-- ever placed in this file or in git history.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- --------------------------------------------------------------------------
-- Secrets: the deployed function's URL and the service-role bearer token it
-- needs are stored via Supabase Vault (`supabase_vault`, enabled by default
-- on every Supabase project, local and hosted) rather than inlined into the
-- cron job's command text. `cron.job.command` is stored in plaintext and
-- readable by anyone who can query `cron.job` — a hard-coded service-role
-- key there would be a live credential leak inside a git-tracked migration
-- and the project's own catalog. Vault secrets are encrypted at rest and
-- only exposed via `vault.decrypted_secrets`, itself owner/service-role
-- readable only.
--
-- The two secrets below are NOT created by this migration (a migration
-- file is git-tracked; committing real values here would be exactly the
-- credential leak this design avoids). After the function is deployed,
-- someone with dashboard/SQL-editor access to the real project runs this
-- once, with real values substituted:
--
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/tick',
--     'tick_function_url'
--   );
--   select vault.create_secret(
--     '<service-role-key-from-project-settings>',
--     'tick_function_service_role_key'
--   );
--
-- `cron.schedule` below reads them by name at execution time, every run —
-- rotating either secret later needs no migration or redeploy.
-- --------------------------------------------------------------------------

select cron.schedule(
  'tick-every-2-minutes',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tick_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'tick_function_service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
