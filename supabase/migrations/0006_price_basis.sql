-- TradeFlow — Step 9: PAXG-vs-spot price calibration.
-- See handoff/ARCHITECT-BRIEF.md ("Step 9 — Decisions") and
-- handoff/BUILD-LOG.md for the full verification story.
--
-- Owner reported TradeFlow's XAUUSD price disagreeing with TradingView's.
-- Root cause: `tick-fast` (Step 8) prices XAUUSD off Binance's PAXG/USDT
-- ticker, a tokenized-gold proxy that trades at its own drifting
-- premium/discount ("basis") to real spot gold — already flagged, but left
-- uncorrected, back in the Step 2 revision. `tick` (every 2 minutes)
-- already fetches chartgoldprice.com as a read-only accuracy check; this
-- migration adds two columns so that check's result can also be *applied*
-- as a correction, not just logged.
--
-- `price_basis`/`price_basis_at` are a separate field pair from
-- `last_price`/`last_price_at` specifically so the Step 8 single-writer
-- invariant per field is preserved: `tick-fast` remains the sole writer of
-- `last_price`/`last_price_at`; `tick` becomes the sole writer of
-- `price_basis`/`price_basis_at`. Neither function writes both.
--
-- Verified LOCALLY (throwaway `supabase start` Docker stack): the `alter
-- table` below applied cleanly against a database already carrying
-- 0001-0005, and a manual `update instruments set price_basis = 5.25,
-- price_basis_at = now() where symbol = 'XAUUSD'` round-tripped through a
-- `select` as expected. Nullable with no default, matching `last_price`'s
-- own null-until-first-tick convention — `price_basis` stays null until
-- `tick`'s first successful calibration.

alter table instruments
  add column if not exists price_basis numeric,
  add column if not exists price_basis_at timestamptz;

-- --------------------------------------------------------------------------
-- Rollback (documented, not executed):
--
--   alter table instruments drop column if exists price_basis;
--   alter table instruments drop column if exists price_basis_at;
--
-- Safe to drop at any time — `tick-fast` treats a missing/null basis as "no
-- correction," so removing these columns just reverts to Step 8's raw-PAXG
-- behavior, not a crash.
-- --------------------------------------------------------------------------
