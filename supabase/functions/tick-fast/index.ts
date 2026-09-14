// TradeFlow — "tick-fast" Edge Function (Deno). Invoked every 10 seconds by
// pg_cron (see supabase/migrations/0005_tick_fast_cron.sql) via pg_net. Per
// invocation: fetches the latest XAUUSD price directly from Binance's
// public PAXG/USDT ticker (no fallback — see handoff/ARCHITECT-BRIEF.md's
// Step 8), corrects it against real spot gold using the basis `tick`
// calibrates every 2 minutes from chartgoldprice.com (Step 9 — see
// packages/alert-engine/src/priceBasis.ts), evaluates the corrected price
// against every enabled/unexpired price_alerts row, sends Web Push
// notifications for anything that fires, and unconditionally updates
// instruments.last_price/last_price_at (the corrected price) on a
// successful fetch. This function is the sole writer of that baseline going
// forward — it never reads or writes graph_reminders (that stays
// exclusively in `tick`).
//
// Split out of `tick/index.ts` as a separate function (not a branching flag
// in the same file) specifically so this hot 10-second path never shares a
// file with Step 6/7's already-reviewed reminder/hardening logic, and so it
// gets its own invocation/duration metrics. See handoff/ARCHITECT-BRIEF.md
// Step 8 Decisions — do not collapse this back into `tick`.
//
// Uses the Supabase **service role** client — same rationale as `tick`
// (no logged-in user in a cron context; RLS is bypassed by design here).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import type { Instrument, PriceAlert } from "@tradeflow/types";
import {
  evaluatePriceAlert,
  type EvaluableAlert,
} from "../../../packages/alert-engine/src/evaluatePriceAlert.ts";
import { BinanceProvider } from "../../../packages/market-data/src/binanceProvider.ts";
import { applyPriceBasis } from "../../../packages/alert-engine/src/priceBasis.ts";
import {
  configureWebPush,
  describeProviderError,
  getRequiredEnv,
  logNotification,
  pushToUserDevices,
} from "../_shared/notifications.ts";

const XAUUSD_SYMBOL = "XAUUSD";

/**
 * Moved verbatim from the pre-Step-8 `tick/index.ts` (including Step 6's
 * confirm-write-before-push ordering) — see handoff/ARCHITECT-BRIEF.md's
 * Step 8 Decisions. Do not weaken or reorder the hardening below while it
 * lives here: the write that marks a crossing "handled" must be confirmed
 * successful *before* a push is sent, so a failed write correctly leaves
 * the crossing to be retried next tick instead of risking a duplicate push.
 */
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

Deno.serve(async (_req: Request) => {
  const now = new Date();
  const supabase = createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );

  configureWebPush();

  const summary: Record<string, unknown> = { timestamp: now.toISOString() };

  const { data: instrument, error: instrumentError } = await supabase
    .from("instruments")
    .select("*")
    .eq("symbol", XAUUSD_SYMBOL)
    .eq("enabled", true)
    .maybeSingle<Instrument>();

  if (instrumentError || !instrument) {
    summary.priceAlerts = { skipped: true, reason: "XAUUSD instrument not found or disabled" };
    return new Response(JSON.stringify(summary), {
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const provider = new BinanceProvider();
    const tick = await provider.getPrice(instrument.symbol);

    // Step 9: correct the raw Binance PAXG price for its drifting
    // premium/discount against real spot gold, using the basis `tick`
    // calibrates every 2 minutes from chartgoldprice.com (see
    // packages/alert-engine/src/priceBasis.ts and handoff/ARCHITECT-BRIEF.md
    // Step 9). `instrument.price_basis` is null until that first
    // calibration lands, in which case this is a no-op (raw price used
    // unchanged) — same self-correcting-over-time shape as every other
    // null-baseline branch in this project. Alerts are evaluated against,
    // and the baseline is written as, this corrected price — not the raw
    // Binance tick — so both alerting and any UI display of "current price"
    // stay consistent with each other.
    const correctedPrice = applyPriceBasis(tick.price, instrument.price_basis);
    summary.price = { raw: tick.price, corrected: correctedPrice, basis: instrument.price_basis };

    summary.priceAlerts = await processPriceAlerts(supabase, instrument, correctedPrice, now);

    // Unconditionally update the tick baseline, even with zero triggers, so
    // the next invocation (10s later) has a correct "previous price." This
    // function is the sole writer of instruments.last_price/last_price_at —
    // `tick` (narrowed, Step 8) never touches it anymore. A failure here
    // just delays detection by one tick (self-corrects in 10s) — logged for
    // visibility, no retry logic needed.
    const { error: instrumentUpdateError } = await supabase
      .from("instruments")
      .update({ last_price: correctedPrice, last_price_at: tick.timestamp })
      .eq("id", instrument.id);
    if (instrumentUpdateError) {
      console.error(`Failed to update instrument ${instrument.id} last_price:`, instrumentUpdateError);
    }
  } catch (err) {
    // No fallback here by design (see handoff/ARCHITECT-BRIEF.md's Step 8
    // Flags) — a single Binance failure just self-corrects on the next
    // 10-second invocation.
    const reason = describeProviderError(err);
    console.error("XAUUSD price fetch (Binance) failed:", reason);
    summary.priceAlerts = { skipped: true, reason };
  }

  return new Response(JSON.stringify(summary), {
    headers: { "content-type": "application/json" },
  });
});
