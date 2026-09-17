// TradeFlow — "tick" Edge Function (Deno). Invoked every 2 minutes by
// pg_cron (see supabase/migrations/0003_cron.sql) via pg_net. Per
// invocation: evaluates due graph_reminders and sends Web Push
// notifications for anything that fires, and calibrates a price basis
// against a fresh Binance read using goldprice.dev as the reference (Step
// 12 — see handoff/ARCHITECT-BRIEF.md's Step 8/9/12).
//
// As of Step 8, price-alert evaluation and the instruments.last_price/
// last_price_at write have moved to the new `tick-fast` Edge Function
// (polled every 10 seconds directly off Binance — see
// supabase/functions/tick-fast/index.ts). This function is now
// **read-only** with respect to `instruments`: it never writes
// last_price/last_price_at. It also never touches `price_alerts`.
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
import type { GraphReminder, Instrument } from "@tradeflow/types";
import { BinanceProvider } from "../../../packages/market-data/src/binanceProvider.ts";
import { GoldPriceDevProvider } from "../../../packages/market-data/src/goldPriceDevProvider.ts";
import { computeNextTriggerAt } from "../../../packages/alert-engine/src/computeNextTriggerAt.ts";
import { computePriceBasis } from "../../../packages/alert-engine/src/priceBasis.ts";
import {
  configureWebPush,
  describeProviderError,
  getRequiredEnv,
  logNotification,
  pushToUserDevices,
} from "../_shared/notifications.ts";

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

    // Same ordering requirement as processPriceAlerts (tick-fast): advance
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

/**
 * Step 8 added this as a routine, read-only accuracy check. Step 9 extended
 * it to also *apply* the result: `tick-fast` prices XAUUSD off Binance's
 * PAXG/USDT ticker, which trades at its own drifting premium/discount
 * ("basis") to real spot gold. Step 12 swaps the reference source from
 * chartgoldprice.com to goldprice.dev — chartgoldprice.com was observed
 * stale for 8+ hours at a time on three separate occasions in this
 * project's history (see handoff/BUILD-LOG.md), while goldprice.dev is
 * keyless (no fallback-quota problem like Step 10's reverted GoldAPI.io
 * attempt), rate-limited generously (100/hour vs. this function's 30/hour
 * usage), and self-reports freshness via `is_stale`.
 * `ChartGoldPriceProvider` is left in place, unused (same convention as
 * `OANDAProvider`/`FallbackMarketDataProvider`).
 *
 * Every 2 minutes: fetch a *fresh* raw Binance price (independent of
 * `instruments.last_price`, which may be MT4-sourced as of Step 11 and so
 * is not a pure raw Binance baseline to compare against) and goldprice.dev's
 * quote, compute the offset between them, and write it to
 * `instruments.price_basis`/`price_basis_at` if it passes a sanity bound
 * (see packages/alert-engine/src/priceBasis.ts) — an outlier reading is
 * logged and skipped, leaving the previous basis in place, rather than
 * letting one bad reading swing the live alert price. `tick` remains the
 * sole writer of `price_basis`/`price_basis_at`, mirroring `tick-fast`'s
 * sole ownership of `last_price`/`last_price_at` — never both from the same
 * function. (This basis only feeds Binance's price — as of Step 11, MT4 is
 * the primary source and never has this correction applied, since it's
 * already the real broker price the correction exists to approximate.)
 */
async function checkPriceBasisAccuracy(
  supabase: SupabaseClient,
): Promise<Record<string, unknown>> {
  const { data: instrument, error: instrumentError } = await supabase
    .from("instruments")
    .select("id, last_price, last_price_at")
    .eq("symbol", XAUUSD_SYMBOL)
    .eq("enabled", true)
    .maybeSingle<Pick<Instrument, "id" | "last_price" | "last_price_at">>();

  if (instrumentError || !instrument) {
    return { skipped: true, reason: "XAUUSD instrument not found or disabled" };
  }

  try {
    const [goldPriceDev, rawBinance] = await Promise.all([
      new GoldPriceDevProvider().getPrice(XAUUSD_SYMBOL),
      new BinanceProvider().getPrice(XAUUSD_SYMBOL),
    ]);

    const basisResult = computePriceBasis(goldPriceDev.price, rawBinance.price);

    if (basisResult.rejected) {
      console.error(
        `Price basis accuracy check: basis update skipped — ${basisResult.reason} ` +
          `(goldPriceDev=${goldPriceDev.price}, rawBinance=${rawBinance.price})`,
      );
      return {
        goldPriceDev: goldPriceDev.price,
        rawBinance: rawBinance.price,
        deltaPct: basisResult.deltaPct,
        basisUpdated: false,
        reason: basisResult.reason,
      };
    }

    const basisAt = new Date().toISOString();
    const { error: basisUpdateError } = await supabase
      .from("instruments")
      .update({ price_basis: basisResult.basis, price_basis_at: basisAt })
      .eq("id", instrument.id);
    if (basisUpdateError) {
      console.error(`Failed to update instrument ${instrument.id} price_basis:`, basisUpdateError);
      return { skipped: true, reason: "price_basis write failed" };
    }

    console.log(
      `Price basis accuracy check: goldPriceDev=${goldPriceDev.price}, ` +
        `rawBinance=${rawBinance.price}, basis=${basisResult.basis.toFixed(4)} ` +
        `(${basisResult.deltaPct.toFixed(4)}%)`,
    );

    return {
      goldPriceDev: goldPriceDev.price,
      rawBinance: rawBinance.price,
      basis: basisResult.basis,
      deltaPct: basisResult.deltaPct,
      basisUpdated: true,
    };
  } catch (err) {
    const reason = describeProviderError(err);
    console.error(`Price basis accuracy check skipped: ${reason}`);
    return { skipped: true, reason };
  }
}

Deno.serve(async (_req: Request) => {
  const now = new Date();
  const supabase = createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );

  configureWebPush();

  const summary: Record<string, unknown> = { timestamp: now.toISOString() };

  // --- Graph reminders: time-based, evaluated independently of any price
  // fetch. ---
  try {
    summary.graphReminders = await processGraphReminders(supabase, now);
  } catch (err) {
    console.error("Graph reminder processing failed:", err);
    summary.graphReminders = { skipped: true, reason: String(err) };
  }

  // --- Price basis calibration against goldprice.dev (Step 12). Writes
  // only instruments.price_basis/price_basis_at — never last_price. ---
  summary.priceBasisCheck = await checkPriceBasisAccuracy(supabase);

  return new Response(JSON.stringify(summary), {
    headers: { "content-type": "application/json" },
  });
});
