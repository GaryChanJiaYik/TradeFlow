-- TradeFlow — Step 11: MT4/TMGM live-tick bridge + order-fill alerts.
-- See handoff/ARCHITECT-BRIEF.md ("Step 11 — Decisions") and
-- handoff/BUILD-LOG.md for the full verification story.
--
-- Owner trades XAUUSD on MT4 (broker TMGM) and wants MT4's real broker tick
-- to become the primary source for instruments.last_price — more accurate
-- than Binance's PAXG/USDT proxy, and it's literally the price they trade
-- at. A custom MQL4 EA on a free VPS pushes ticks (and order-fill events)
-- to a new `mt4-webhook` Edge Function. Binance polling in `tick-fast`
-- stays as an automatic fallback (see mt4_last_seen_at below) since the
-- free 1GB-RAM VPS running MT4 under Wine is a real reliability risk.
--
-- Verified LOCALLY (throwaway `supabase start` Docker stack): `alter table`
-- below applied cleanly against a database already carrying 0001-0006, and
-- a manual update/select round-tripped the new columns/constraint as
-- expected.

-- ---------------------------------------------------------------------------
-- instruments: MT4 heartbeat + observability breadcrumb.
--
-- mt4_last_seen_at: written ONLY by the new mt4-webhook function, using
-- that function's OWN clock (Deno's `new Date()` at request-receipt time —
-- never the EA-reported timestamp), so tick-fast's freshness gate never has
-- to trust a flaky VPS's clock. Null = "MT4 has never reported" (today's
-- Binance-only behavior, unchanged).
--
-- price_source: write-only observability breadcrumb (which source most
-- recently wrote last_price/last_price_at) — NOT read by the fallback
-- decision itself (that's mt4_last_seen_at + now() alone in tick-fast's
-- `isMt4Fresh`), so it can never disagree with the real decision. Defaults
-- to 'BINANCE' to match every existing row's current (and only ever) source
-- before this migration.
-- ---------------------------------------------------------------------------
alter table instruments
  add column if not exists mt4_last_seen_at timestamptz,
  add column if not exists price_source text not null default 'BINANCE';

alter table instruments
  add constraint instruments_price_source_check
  check (price_source in ('MT4', 'BINANCE'));

-- ---------------------------------------------------------------------------
-- notification_log: add ORDER_FILLED to event_type, for the EA's
-- order-fill-detected push notifications (see mt4-webhook/index.ts).
--
-- The constraint name below (`notification_log_event_type_check`) is
-- Postgres's default auto-generated name for the inline unnamed check() in
-- 0001_init.sql. Confirm before running if unsure:
--   select conname from pg_constraint
--   where conrelid = 'public.notification_log'::regclass and contype = 'c';
-- ---------------------------------------------------------------------------
alter table notification_log
  drop constraint notification_log_event_type_check;

alter table notification_log
  add constraint notification_log_event_type_check
  check (event_type in ('PRICE_ALERT', 'GRAPH_REMINDER', 'ORDER_FILLED'));

-- --------------------------------------------------------------------------
-- Rollback (documented, not executed):
--
--   alter table notification_log drop constraint notification_log_event_type_check;
--   alter table notification_log add constraint notification_log_event_type_check
--     check (event_type in ('PRICE_ALERT', 'GRAPH_REMINDER'));
--   alter table instruments drop constraint if exists instruments_price_source_check;
--   alter table instruments drop column if exists price_source;
--   alter table instruments drop column if exists mt4_last_seen_at;
--
-- Safe to drop at any time: `tick-fast` treats a missing/null
-- mt4_last_seen_at as "MT4 never reported" and simply reverts to Step
-- 9/10's Binance-only behavior; `mt4-webhook` would just stop being able to
-- write ORDER_FILLED rows or the two instruments columns.
-- --------------------------------------------------------------------------
