/**
 * Shared literal-union "enum" types. These mirror Postgres CHECK/enum
 * constraints defined in supabase/migrations/0001_init.sql — keep in sync.
 */

export type AlertDirection = "CROSS_UP" | "CROSS_DOWN" | "CROSS_BOTH";

export type AlertTriggerMode = "ONCE" | "EVERY_TIME";

export type ReminderTimeframe = "15m" | "1H" | "4H" | "1D";

export type AssetType = "metal" | "forex" | "index" | "crypto";

export type DevicePlatform = "web" | "ios" | "android";

export type NotificationEventType = "PRICE_ALERT" | "GRAPH_REMINDER";

export type NotificationStatus = "SENT" | "FAILED" | "PENDING";
