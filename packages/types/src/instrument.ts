import type { AssetType } from "./enums";

/**
 * Mirrors the `instruments` table (supabase/migrations/0001_init.sql).
 * `last_price` / `last_price_at` hold the most recent tick used as the
 * "previous price" input for alert-engine crossing comparisons.
 */
export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  asset_type: AssetType;
  enabled: boolean;
  last_price: number | null;
  last_price_at: string | null; // ISO timestamp
  created_at: string; // ISO timestamp
}
