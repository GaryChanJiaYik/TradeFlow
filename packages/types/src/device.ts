import type { DevicePlatform } from "./enums";

/**
 * Minimal shape of a Web Push `PushSubscription` as it will be stored in the
 * `devices.subscription` JSONB column starting Step 2. Defined loosely here
 * (not implemented/consumed until Step 2) so the column has a documented
 * shape without depending on DOM lib push types.
 */
export interface WebPushSubscriptionJson {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Mirrors the `devices` table (supabase/migrations/0001_init.sql).
 */
export interface Device {
  id: string;
  user_id: string;
  platform: DevicePlatform;
  subscription: WebPushSubscriptionJson | null;
  enabled: boolean;
  last_seen_at: string | null; // ISO timestamp
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}
