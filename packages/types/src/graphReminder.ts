import type { ReminderTimeframe } from "./enums";

/**
 * Mirrors the `graph_reminders` table (supabase/migrations/0001_init.sql).
 */
export interface GraphReminder {
  id: string;
  user_id: string;
  instrument_id: string;
  timeframe: ReminderTimeframe;
  description: string | null;
  timezone: string; // IANA timezone name, e.g. "Asia/Kuala_Lumpur"
  enabled: boolean;
  next_trigger_at: string; // ISO timestamp
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}
