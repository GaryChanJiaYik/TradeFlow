// TradeFlow — "tick" Edge Function (Deno). Invoked every 2 minutes by
// pg_cron (see supabase/migrations/0003_cron.sql) via pg_net. Per
// invocation: fetches the latest XAUUSD price — primary source
// chartgoldprice.com's real spot-gold feed, falling back automatically to
// Binance's public PAXG/USDT ticker if the primary fails or returns stale
// data (see handoff/ARCHITECT-BRIEF.md's Step 7) — evaluates it against
// every enabled/unexpired price_alerts row, evaluates due graph_reminders,
// sends Web Push notifications for anything that fires, and unconditionally
// updates instruments.last_price/last_price_at.
//
// Uses the Supabase **service role** client — this is the one place
// service-role access is needed, since there's no logged-in user in a cron
// context and RLS is bypassed by design here (see
// handoff/ARCHITECT-BRIEF.md Step 2 Decisions).
//
// evaluatePriceAlert, computeNextTriggerAt, and the market-data providers are
// imported via a *relative filesystem path* into the TS source of
// packages/alert-engine and packages/market-data, not the @tradeflow/*
// workspace specifiers — Deno
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
import { BinanceProvider, BinanceProviderError } from "../../../packages/market-data/src/binanceProvider.ts";
import {
  ChartGoldPriceProvider,
  ChartGoldPriceProviderError,
} from "../../../packages/market-data/src/chartGoldPriceProvider.ts";
import {
  FallbackMarketDataProvider,
  FallbackProviderError,
} from "../../../packages/market-data/src/fallbackProvider.ts";
import { computeNextTriggerAt } from "../../../packages/alert-engine/src/computeNextTriggerAt.ts";

const XAUUSD_SYMBOL = "XAUUSD";

/**
 * Step 5: `graph_reminders.window_start_time`/`window_end_time` (Postgres
 * `time` columns, round-tripping as `"HH:MM:SS"` strings) -> the
 * `computeNextTriggerAt` window arg (minutes-since-midnight). Mirrors
 * `apps/web/app/dashboard/reminder-actions.ts`'s identical helper — kept
 * duplicated rather than shared, same call as that file's
 * `getXauUsdInstrumentId` comment: the web app and this Deno function are
 * already independent today, and the brief's Step 5 flags ask to keep
 * `computeNextTriggerAt` itself the shared single source of truth, not
 * every string-parsing caller around it.
 *
 * Without this, a windowed reminder's *first* `next_trigger_at` (computed
 * by the web app at create/edit time) would respect the window, but every
 * occurrence after the first fire — recomputed here — would silently
 * revert to unrestricted/midnight-anchored behavior. Not called out in
 * handoff/ARCHITECT-BRIEF.md's Step 5 Build Order/Definition of Done;
 * treated as in-scope anyway since leaving it out would break the feature
 * within one tick cycle in production. Flagged in handoff/BUILD-LOG.md for
 * Arch's awareness.
 */
function timeStringToMinutes(value: string): number {
  const [hourStr, minuteStr] = value.split(":");
  return Number(hourStr) * 60 + Number(minuteStr);
}

function buildReminderWindowArg(
  reminder: Pick<GraphReminder, "window_start_time" | "window_end_time">,
): { startMinutes: number; endMinutes: number } | undefined {
  if (!reminder.window_start_time || !reminder.window_end_time) return undefined;
  return {
    startMinutes: timeStringToMinutes(reminder.window_start_time),
    endMinutes: timeStringToMinutes(reminder.window_end_time),
  };
}

/**
 * Formats one provider-level error for the tick response summary. Handles
 * both typed provider errors (with a `.code`) and anything else that
 * bubbled up unexpectedly, so a real failure always logs something
 * actionable instead of an opaque `[object Object]`. Step 7.
 */
function describeProviderError(err: unknown): string {
  if (err instanceof ChartGoldPriceProviderError || err instanceof BinanceProviderError) {
    return `${err.code}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * Step 7: primary/fallback pair for XAUUSD. ChartGoldPriceProvider (real
 * spot gold, keyless, no documented rate limit, but no named operator or
 * SLA) is tried first; BinanceProvider (PAXG/USDT, already proven live in
 * production) is the automatic fallback if it fails or returns stale data.
 * Both are keyless — no env vars needed. See
 * handoff/ARCHITECT-BRIEF.md's Step 7 Decisions.
 */
function buildFallbackProvider(): FallbackMarketDataProvider {
  return new FallbackMarketDataProvider([new ChartGoldPriceProvider(), new BinanceProvider()]);
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

    // The write that marks this crossing "handled" must be confirmed
    // successful *before* a push is sent. If it fails, the alert's state
    // never changes, so skip the notification and let the next tick see
    // the identical crossing as still valid and correctly retry — instead
    // of firing a push now and potentially firing a duplicate next tick
    // too. See handoff/ARCHITECT-BRIEF.md Step 6.
    const update: Record<string, unknown> = { last_triggered_at: now.toISOString() };
    if (alert.trigger_mode === "ONCE") update.enabled = false;
    const { error: updateError } = await supabase.from("price_alerts").update(update).eq("id", alert.id);
    if (updateError) {
      console.error(`Failed to mark price alert ${alert.id} as triggered, will retry next tick:`, updateError);
      continue;
    }

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

    // Same ordering requirement as processPriceAlerts: advance
    // next_trigger_at and confirm it succeeded *before* sending a push. If
    // the write fails, the reminder stays "due" and the next tick correctly
    // retries it instead of also firing a duplicate push here. See
    // handoff/ARCHITECT-BRIEF.md Step 6.
    const nextTriggerAt = computeNextTriggerAt(
      reminder.timeframe,
      reminder.timezone,
      now,
      buildReminderWindowArg(reminder),
    );
    const { error: updateError } = await supabase
      .from("graph_reminders")
      .update({ next_trigger_at: nextTriggerAt.toISOString() })
      .eq("id", reminder.id);
    if (updateError) {
      console.error(`Failed to advance graph reminder ${reminder.id}, will retry next tick:`, updateError);
      continue;
    }

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
      const provider = buildFallbackProvider();
      const tick = await provider.getPrice(instrument.symbol);

      summary.priceAlerts = await processPriceAlerts(supabase, instrument, tick.price, now);

      // Unconditionally update the tick baseline, even with zero triggers,
      // so the next invocation has a correct "previous price." A failure
      // here just delays detection by one tick (self-corrects next
      // invocation) — logged for visibility, no retry logic needed.
      const { error: instrumentUpdateError } = await supabase
        .from("instruments")
        .update({ last_price: tick.price, last_price_at: tick.timestamp })
        .eq("id", instrument.id);
      if (instrumentUpdateError) {
        console.error(`Failed to update instrument ${instrument.id} last_price:`, instrumentUpdateError);
      }
    } catch (err) {
      // FallbackMarketDataProvider already console.error-logs each individual
      // provider's failure as it happens (see fallbackProvider.ts); this only
      // needs to summarize what ultimately reached the tick's response. A
      // FallbackProviderError means every provider failed — its `.errors`
      // holds each one's detail, unwrapped here instead of collapsed into an
      // opaque top-level message. Chart/BinanceProviderError also handled
      // directly in case a caller bypasses the fallback wrapper in the future.
      const reason =
        err instanceof FallbackProviderError
          ? `${err.code}: ${err.errors.map((e) => describeProviderError(e)).join("; ")}`
          : describeProviderError(err);
      console.error("XAUUSD price fetch failed:", reason);
      summary.priceAlerts = { skipped: true, reason };
    }
  }

  // --- Graph reminders: time-based, evaluated regardless of whether the
  // Binance fetch above succeeded (they don't depend on price). ---
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
