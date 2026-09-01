-- TradeFlow — Step 5: configurable market-open/close window for graph
-- reminders. See handoff/ARCHITECT-BRIEF.md ("Step 5 — Decisions") and
-- handoff/BUILD-LOG.md for the full story.
--
-- NOT YET APPLIED to the live Supabase project as of writing — this
-- network blocks direct Postgres connections, so `supabase db push` hangs
-- (same constraint already on record as handoff/BUILD-LOG.md's KG-8, first
-- hit by 0003_cron.sql). Arch will apply this DDL manually via the
-- Supabase dashboard SQL Editor after review clears, then update
-- handoff/BUILD-LOG.md to confirm it's live before anything depending on
-- these columns (the UI window inputs, the tick Edge Function reading
-- them) is exercised against the real project.
--
-- Both columns nullable, default NULL — fully backward compatible with
-- every existing graph_reminders row (they keep their current
-- midnight-anchored, unrestricted-grid behavior with zero migration/backfill
-- needed). The CHECK constraint mirrors the app-level zod refine in
-- packages/validation/src/graphReminder.ts (defense in depth, per the
-- brief: don't rely on the DB alone to catch a one-of-two-set input) —
-- either both set or both null, never just one.

alter table public.graph_reminders
  add column window_start_time time null,
  add column window_end_time time null;

alter table public.graph_reminders
  add constraint graph_reminders_window_both_or_neither
  check ((window_start_time is null) = (window_end_time is null));
