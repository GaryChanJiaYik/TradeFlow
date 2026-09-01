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
  // Optional market-open/close window (Step 5). Both null (the default) or
  // both set — DB CHECK-constrained, see supabase/migrations/0004_reminder_window.sql.
  // Postgres `time` columns come back from PostgREST as "HH:MM:SS" strings.
  window_start_time: string | null;
  window_end_time: string | null;
  enabled: boolean;
  next_trigger_at: string; // ISO timestamp
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}
