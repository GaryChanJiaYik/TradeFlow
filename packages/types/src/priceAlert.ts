import type { AlertDirection, AlertTriggerMode } from "./enums";

/**
 * Mirrors the `price_alerts` table (supabase/migrations/0001_init.sql).
 */
export interface PriceAlert {
  id: string;
  user_id: string;
  instrument_id: string;
  target_price: number;
  direction: AlertDirection;
  trigger_mode: AlertTriggerMode;
  expiration_at: string | null; // ISO timestamp
  message: string | null;
  enabled: boolean;
  last_triggered_at: string | null; // ISO timestamp
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}
