// TradeFlow — "tick" Edge Function (Deno). Invoked every 2 minutes by
// pg_cron (see supabase/migrations/0003_cron.sql) via pg_net. Per
// invocation: fetches the latest XAUUSD price from OANDA, evaluates it
// against every enabled/unexpired price_alerts row, evaluates due
// graph_reminders, sends Web Push notifications for anything that fires,
// and unconditionally updates instruments.last_price/last_price_at.
//
// Uses the Supabase **service role** client — this is the one place
// service-role access is needed, since there's no logged-in user in a cron
// context and RLS is bypassed by design here (see
// handoff/ARCHITECT-BRIEF.md Step 2 Decisions).
//
// evaluatePriceAlert and OANDAProvider are imported via a *relative
// filesystem path* into the TS source of packages/alert-engine and
// packages/market-data, not the @tradeflow/* workspace specifiers — Deno
// executes TypeScript directly and doesn't need node_modules resolution
// for relative imports, so no esbuild/bundling step is needed. This keeps
// the tested, reviewed logic as the single source of truth instead of
// duplicating it inline. See supabase/functions/deno.json for the two
// pieces of Deno config this relies on (documented there).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import type { Device, GraphReminder, Instrument, PriceAlert } from "@tradeflow/types";
import {
  evaluatePriceAlert,
  type EvaluableAlert,
} from "../../../packages/alert-engine/src/evaluatePriceAlert.ts";
import { OANDAProvider, OANDAProviderError } from "../../../packages/market-data/src/oandaProvider.ts";
import { computeNextTriggerAt } from "./nextTrigger.ts";

const XAUUSD_SYMBOL = "XAUUSD";

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function buildOandaProvider(): OANDAProvider {
  const environment = Deno.env.get("OANDA_ENV") ?? "practice";
  if (environment !== "practice") {
    throw new Error(`Unsupported OANDA_ENV "${environment}" — only "practice" is supported in V1.`);
  }
  return new OANDAProvider({
    apiToken: getRequiredEnv("OANDA_API_TOKEN"),
    accountId: getRequiredEnv("OANDA_ACCOUNT_ID"),
    environment,
  });
}

function configureWebPush(): void {
  webpush.setVapidDetails(
    getRequiredEnv("VAPID_SUBJECT"),
    getRequiredEnv("VAPID_PUBLIC_KEY"),
    getRequiredEnv("VAPID_PRIVATE_KEY"),
  );
}

interface PushResult {
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
async function pushToUserDevices(
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
        await supabase.from("devices").update({ enabled: false }).eq("id", device.id);
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
async function logNotification(
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

  await supabase.from("notification_log").insert({
    user_id: params.userId,
    device_id: null,
    event_type: params.eventType,
    title: params.title,
    message: params.message,
    status,
    sent_at: status === "SENT" ? new Date().toISOString() : null,
  });
}

async function processPriceAlerts(
  supabase: SupabaseClient,
  instrument: Instrument,
  currentPrice: number,
  now: Date,
): Promise<{ evaluated: number; triggered: number }> {
  if (instrument.last_price === null) {
    // First tick ever for this instrument: nothing to compare against yet.
    // The caller still unconditionally seeds last_price/last_price_at.
    return { evaluated: 0, triggered: 0 };
  }
  const previousPrice = Number(instrument.last_price);

  const { data: alerts, error } = await supabase
    .from("price_alerts")
    .select("*")
    .eq("instrument_id", instrument.id)
    .eq("enabled", true)
    .or(`expiration_at.is.null,expiration_at.gt.${now.toISOString()}`)
    .returns<PriceAlert[]>();

  if (error || !alerts) return { evaluated: 0, triggered: 0 };

  let triggered = 0;
  for (const alert of alerts) {
    const targetPrice = Number(alert.target_price);
    const evaluable: EvaluableAlert = {
      target_price: targetPrice,
      direction: alert.direction,
      trigger_mode: alert.trigger_mode,
      expiration_at: alert.expiration_at,
      enabled: alert.enabled,
      last_triggered_at: alert.last_triggered_at,
    };

    if (!evaluatePriceAlert(evaluable, previousPrice, currentPrice, now)) continue;
    triggered++;

    const update: Record<string, unknown> = { last_triggered_at: now.toISOString() };
    if (alert.trigger_mode === "ONCE") update.enabled = false;
    await supabase.from("price_alerts").update(update).eq("id", alert.id);

    // Only used to word the notification (which direction actually
    // happened) — not a re-decision of whether the alert should fire;
    // evaluatePriceAlert already made that call above.
    const crossedUp = previousPrice < targetPrice && currentPrice >= targetPrice;
    const title = `${instrument.symbol} Price Alert`;
    const message = [
      `${instrument.symbol} crossed ${targetPrice} ${crossedUp ? "upward" : "downward"}.`,
      alert.message?.trim() || null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" ");

    const push = await pushToUserDevices(supabase, alert.user_id, {
      title,
      body: message,
      eventType: "PRICE_ALERT",
      alertId: alert.id,
    });
    await logNotification(supabase, {
      userId: alert.user_id,
      eventType: "PRICE_ALERT",
      title,
      message,
      push,
    });
  }

  return { evaluated: alerts.length, triggered };
}

async function processGraphReminders(
  supabase: SupabaseClient,
  now: Date,
): Promise<{ evaluated: number; triggered: number }> {
  const { data: reminders, error } = await supabase
    .from("graph_reminders")
    .select("*, instruments(symbol)")
    .eq("enabled", true)
    .lte("next_trigger_at", now.toISOString())
    .returns<(GraphReminder & { instruments: { symbol: string } | null })[]>();

  if (error || !reminders) return { evaluated: 0, triggered: 0 };

  for (const reminder of reminders) {
    const symbol = reminder.instruments?.symbol ?? XAUUSD_SYMBOL;
    const title = `${symbol} Chart Reminder`;
    const trimmedDescription = reminder.description?.trim();
    const message = trimmedDescription ? trimmedDescription : `Check the ${symbol} ${reminder.timeframe} chart.`;

    const push = await pushToUserDevices(supabase, reminder.user_id, {
      title,
      body: message,
      eventType: "GRAPH_REMINDER",
      reminderId: reminder.id,
    });
    await logNotification(supabase, {
      userId: reminder.user_id,
      eventType: "GRAPH_REMINDER",
      title,
      message,
      push,
    });

    const nextTriggerAt = computeNextTriggerAt(reminder.timeframe, reminder.timezone, now);
    await supabase
      .from("graph_reminders")
      .update({ next_trigger_at: nextTriggerAt.toISOString() })
      .eq("id", reminder.id);
  }

  return { evaluated: reminders.length, triggered: reminders.length };
}

Deno.serve(async (_req: Request) => {
  const now = new Date();
  const supabase = createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );

  configureWebPush();

  const summary: Record<string, unknown> = { timestamp: now.toISOString() };

  // --- Price tick + price_alerts (XAUUSD only in V1) ---
  const { data: instrument, error: instrumentError } = await supabase
    .from("instruments")
    .select("*")
    .eq("symbol", XAUUSD_SYMBOL)
    .eq("enabled", true)
    .maybeSingle<Instrument>();

  if (instrumentError || !instrument) {
    summary.priceAlerts = { skipped: true, reason: "XAUUSD instrument not found or disabled" };
  } else {
    try {
      const provider = buildOandaProvider();
      const tick = await provider.getPrice(instrument.symbol);

      summary.priceAlerts = await processPriceAlerts(supabase, instrument, tick.price, now);

      // Unconditionally update the tick baseline, even with zero triggers,
      // so the next invocation has a correct "previous price."
      await supabase
        .from("instruments")
        .update({ last_price: tick.price, last_price_at: tick.timestamp })
        .eq("id", instrument.id);
    } catch (err) {
      const reason = err instanceof OANDAProviderError ? `${err.code}: ${err.message}` : String(err);
      console.error("OANDA price fetch failed:", reason);
      summary.priceAlerts = { skipped: true, reason };
    }
  }

  // --- Graph reminders: time-based, evaluated regardless of whether the
  // OANDA fetch above succeeded (they don't depend on price). ---
  try {
    summary.graphReminders = await processGraphReminders(supabase, now);
  } catch (err) {
    console.error("Graph reminder processing failed:", err);
    summary.graphReminders = { skipped: true, reason: String(err) };
  }

  return new Response(JSON.stringify(summary), {
    headers: { "content-type": "application/json" },
  });
});
