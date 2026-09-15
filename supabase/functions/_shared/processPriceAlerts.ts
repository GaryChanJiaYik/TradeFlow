// TradeFlow — shared price-alert evaluator, used by both "tick-fast"
// (Binance-driven, every 10s) and "mt4-webhook" (MT4/TMGM-driven, pushed on
// every real broker tick — see handoff/ARCHITECT-BRIEF.md's Step 11).
// Extracted verbatim out of the pre-Step-11 `tick-fast/index.ts` (including
// Step 6's confirm-write-before-push ordering) — a mechanical move, not a
// rewrite, so both callers share one copy of this logic instead of drifting
// apart. Do not weaken or reorder the hardening below while moving/editing
// code around it.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import type { Instrument, PriceAlert } from "@tradeflow/types";
import {
  evaluatePriceAlert,
  type EvaluableAlert,
} from "../../../packages/alert-engine/src/evaluatePriceAlert.ts";
import { logNotification, pushToUserDevices } from "./notifications.ts";

/**
 * Evaluates `currentPrice` (already source-corrected by the caller — Binance
 * basis-adjusted for `tick-fast`, or MT4/TMGM's real price used as-is for
 * `mt4-webhook`) against every enabled/unexpired price_alerts row for
 * `instrument`, sending Web Push notifications for anything that fires.
 *
 * The write that marks a crossing "handled" must be confirmed successful
 * *before* a push is sent: if it fails, the alert's state never changes, so
 * skip the notification and let the next tick see the identical crossing as
 * still valid and correctly retry — instead of firing a push now and
 * potentially firing a duplicate next tick too. See
 * handoff/ARCHITECT-BRIEF.md Step 6.
 */
export async function processPriceAlerts(
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
