import type { NotificationEventType, NotificationStatus } from "./enums";

/**
 * Mirrors the `notification_log` table (supabase/migrations/0001_init.sql).
 */
export interface NotificationLog {
  id: string;
  user_id: string;
  device_id: string | null;
  event_type: NotificationEventType;
  title: string;
  message: string;
  status: NotificationStatus;
  sent_at: string | null; // ISO timestamp
  created_at: string; // ISO timestamp
}
