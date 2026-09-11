-- TradeFlow — Step 8: pg_cron schedule for the new "tick-fast" Edge
-- Function (10-second Binance-driven price-alert polling). See
-- handoff/ARCHITECT-BRIEF.md ("Step 8 — Decisions") and
-- handoff/BUILD-LOG.md for the full verification story.
--
-- IMPORTANT: the existing `tick-every-2-minutes` job (job id 1, created by
-- supabase/migrations/0003_cron.sql) needs NO changes as part of this
-- migration — only the code behind its URL changed (it now runs the
-- narrowed `tick` function: reminders + read-only chartgoldprice accuracy
-- check). This migration only ADDS a second, independent job for the new
-- `tick-fast` function.
--
-- Same deploy-order caveat as 0003_cron.sql: this cannot actually fire
-- successfully until (a) the `tick-fast` function is deployed
-- (`supabase functions deploy tick-fast`), and (b) the
-- `tick_fast_function_url` Vault secret (below) is created. Applying this
-- migration before either of those is harmless on its own — the schedule
-- will just get HTTP errors from `net.http_post` until then.
--
-- pg_cron/pg_net/supabase_vault are already enabled by 0003_cron.sql; the
-- `if not exists` there makes re-declaring them here unnecessary.
--
-- Verified LOCALLY (throwaway `supabase start` Docker stack only, per
-- handoff/BUILD-LOG.md): the `'10 seconds'` schedule string — Supabase's
-- pg_cron extension supports sub-minute intervals as `'N seconds'`, distinct
-- from standard cron's 1-minute floor — registered successfully via
-- `cron.schedule(...)` and `select * from cron.job where jobname =
-- 'tick-fast-every-10-seconds'` showed `schedule = '10 seconds'` with the
-- job active. Never run against the real project, and no real project
-- URL/service-role key was ever placed in this file or in git history.

-- --------------------------------------------------------------------------
-- Secret: only the URL is new here (`tick_fast_function_url`). The bearer
-- token reuses the *existing* `tick_function_service_role_key` secret
-- created for 0003_cron.sql — it's the same project service-role key
-- either function needs, so there is no reason to store a second copy of
-- the same credential under a new name.
--
-- Not created by this migration (a migration file is git-tracked;
-- committing a real value here would be exactly the credential leak Vault
-- exists to avoid). After the `tick-fast` function is deployed, someone
-- with dashboard/SQL-editor access to the real project runs this once, with
-- the real value substituted:
--
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/tick-fast',
--     'tick_fast_function_url'
--   );
--
-- (`tick_function_service_role_key` already exists from 0003_cron.sql —
-- nothing further to create for it.)
-- --------------------------------------------------------------------------

select cron.schedule(
  'tick-fast-every-10-seconds',
  '10 seconds',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tick_fast_function_url'),
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

-- --------------------------------------------------------------------------
-- Rollback (documented, not executed): if the 10-second cadence needs to be
-- pulled — e.g. runaway invocation overlap, unexpected load — this removes
-- only the new job and leaves `tick-every-2-minutes` (job id 1) untouched:
--
--   select cron.unschedule('tick-fast-every-10-seconds');
-- --------------------------------------------------------------------------
