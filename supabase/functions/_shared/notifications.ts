// TradeFlow — shared Web Push / notification-log helpers used by both the
// "tick" (reminders + chartgoldprice accuracy check) and "tick-fast"
// (price alerts) Edge Functions. Extracted byte-for-byte out of the
// pre-Step-8 `tick/index.ts` (see handoff/ARCHITECT-BRIEF.md's Step 8) — a
// mechanical move, not a rewrite, so both functions share one copy of this
// logic instead of drifting apart.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import type { Device } from "@tradeflow/types";
import { BinanceProviderError } from "../../../packages/market-data/src/binanceProvider.ts";
import { ChartGoldPriceProviderError } from "../../../packages/market-data/src/chartGoldPriceProvider.ts";

/**
 * Formats one provider-level error for a function's response summary.
 * Handles both typed provider errors (with a `.code`) and anything else
 * that bubbled up unexpectedly, so a real failure always logs something
 * actionable instead of an opaque `[object Object]`. Step 7.
 */
export function describeProviderError(err: unknown): string {
  if (err instanceof ChartGoldPriceProviderError || err instanceof BinanceProviderError) {
    return `${err.code}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function configureWebPush(): void {
  webpush.setVapidDetails(
    getRequiredEnv("VAPID_SUBJECT"),
    getRequiredEnv("VAPID_PUBLIC_KEY"),
    getRequiredEnv("VAPID_PRIVATE_KEY"),
  );
}

export interface PushResult {
  attempted: number;
  sent: number;
}

/**
 * Sends one Web Push notification to every enabled device belonging to
 * `userId`. A device whose subscription has expired/been revoked
 * (HTTP 404/410 from the push service) is disabled so we stop retrying it;
 * any other per-device failure is logged and does not stop delivery to the
 * user's remaining devices.
 */
export async function pushToUserDevices(
  supabase: SupabaseClient,
  userId: string,
  payload: Record<string, unknown>,
): Promise<PushResult> {
  const { data: devices, error } = await supabase
    .from("devices")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true)
    .returns<Device[]>();

  if (error || !devices) return { attempted: 0, sent: 0 };

  let sent = 0;
  for (const device of devices) {
    if (!device.subscription) continue;
    try {
      // web-push's TS definitions don't exactly match our stored JSON shape
      // (WebPushSubscriptionJson) but are structurally compatible at
      // runtime — this is the one intentional loose cast in this file.
      // deno-lint-ignore no-explicit-any
      await webpush.sendNotification(device.subscription as any, JSON.stringify(payload));
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        const { error: disableError } = await supabase
          .from("devices")
          .update({ enabled: false })
          .eq("id", device.id);
        if (disableError) {
          console.error(`Failed to disable dead device ${device.id}:`, disableError);
        }
      } else {
        console.error(`Push failed for device ${device.id}:`, err);
      }
    }
  }
  return { attempted: devices.length, sent };
}

/**
 * One notification_log row per triggered event (not per device — the log
 * records "this alert/reminder fired," not per-device delivery detail).
 * `device_id` is left null since the same event may fan out to several of
 * the user's devices.
 *
 * Status: SENT if at least one device received it, FAILED if every push
 * attempt failed, PENDING if the user had no enabled device to push to at
 * all (distinct from FAILED — there was nothing to fail, just nothing to
 * deliver to yet). Not specified to this level of detail in the brief;
 * flagged as a Builder decision.
 */
export async function logNotification(
  supabase: SupabaseClient,
  params: {
    userId: string;
    eventType: "PRICE_ALERT" | "GRAPH_REMINDER";
    title: string;
    message: string;
    push: PushResult;
  },
): Promise<void> {
  const status: "SENT" | "FAILED" | "PENDING" =
    params.push.attempted === 0 ? "PENDING" : params.push.sent > 0 ? "SENT" : "FAILED";

  const { error } = await supabase.from("notification_log").insert({
    user_id: params.userId,
    device_id: null,
    event_type: params.eventType,
    title: params.title,
    message: params.message,
    status,
    sent_at: status === "SENT" ? new Date().toISOString() : null,
  });
  if (error) {
    console.error(
      `Failed to write notification_log row for user ${params.userId} (${params.eventType}):`,
      error,
    );
  }
}
