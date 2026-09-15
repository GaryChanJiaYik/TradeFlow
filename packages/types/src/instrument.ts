import type { AssetType, PriceSource } from "./enums";

/**
 * Mirrors the `instruments` table (supabase/migrations/0001_init.sql,
 * extended by 0006_price_basis.sql and 0007_mt4_webhook.sql). `last_price` /
 * `last_price_at` hold the most recent tick used as the "previous price"
 * input for alert-engine crossing comparisons. `price_basis` /
 * `price_basis_at` hold the Step 9 chartgoldprice-vs-Binance calibration
 * offset — see packages/alert-engine/src/priceBasis.ts. `mt4_last_seen_at` /
 * `price_source` are Step 11's MT4-primary/Binance-fallback bookkeeping —
 * see supabase/functions/tick-fast/index.ts's `isMt4Fresh`.
 */
export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  asset_type: AssetType;
  enabled: boolean;
  last_price: number | null;
  last_price_at: string | null; // ISO timestamp
  price_basis: number | null;
  price_basis_at: string | null; // ISO timestamp
  mt4_last_seen_at: string | null; // ISO timestamp
  price_source: PriceSource;
  created_at: string; // ISO timestamp
}
