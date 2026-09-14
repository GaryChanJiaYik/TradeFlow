// TradeFlow — "tick" Edge Function (Deno). Invoked every 2 minutes by
// pg_cron (see supabase/migrations/0003_cron.sql) via pg_net. Per
// invocation: evaluates due graph_reminders and sends Web Push
// notifications for anything that fires, and calibrates a price basis
// against the Binance baseline that `tick-fast` maintains (see
// handoff/ARCHITECT-BRIEF.md's Step 8/9/10) using chartgoldprice.com,
// falling back to GoldAPI.io only when chartgoldprice.com itself fails.
//
// As of Step 8, price-alert evaluation and the instruments.last_price/
// last_price_at write have moved to the new `tick-fast` Edge Function
// (polled every 10 seconds directly off Binance — see
// supabase/functions/tick-fast/index.ts). This function writes only
// `instruments.price_basis`/`price_basis_at` (Step 9/10) — it never writes
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
import { ChartGoldPriceProvider } from "../../../packages/market-data/src/chartGoldPriceProvider.ts";
import { GoldApiProvider } from "../../../packages/market-data/src/goldApiProvider.ts";
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
 * Step 10: chartgoldprice.com has "no SLA, as-is/as-available" (see
 * ChartGoldPriceProvider's own doc comment and KG-15) and has been
 * observed stale for hours at a time in production. Rather than let the
 * basis calibration below go stale for that whole outage window, fall back
 * to GoldAPI.io — sourced from `FOREXCOM:XAUUSD`, a real forex/CFD feed —
 * *only* when chartgoldprice.com's own fetch/staleness check rejects. This
 * keeps GoldAPI.io usage naturally low (it's only ever called during a
 * chartgoldprice.com outage), which matters because its free tier is
 * capped at 100 requests/month — far too low to call on every 2-minute
 * tick unconditionally. `GOLDAPI_API_KEY` is optional: if unset, a
 * chartgoldprice.com failure just skips this tick's calibration entirely,
 * same as Step 9's original behavior.
 */
async function fetchCalibrationReference(): Promise<{ price: number; source: string }> {
  try {
    const chartGoldPrice = await new ChartGoldPriceProvider().getPrice(XAUUSD_SYMBOL);
    return { price: chartGoldPrice.price, source: "CHARTGOLDPRICE" };
  } catch (chartGoldPriceErr) {
    const chartGoldPriceReason = describeProviderError(chartGoldPriceErr);
    const goldApiKey = Deno.env.get("GOLDAPI_API_KEY");
    if (!goldApiKey) {
      throw new Error(
        `chartgoldprice.com failed (${chartGoldPriceReason}) and no GOLDAPI_API_KEY is configured for fallback.`,
      );
    }
    console.error(
      `chartgoldprice.com calibration reference failed (${chartGoldPriceReason}); falling back to GoldAPI.io.`,
    );
    try {
      const goldApi = await new GoldApiProvider({ apiKey: goldApiKey }).getPrice(XAUUSD_SYMBOL);
      return { price: goldApi.price, source: "GOLDAPI" };
    } catch (goldApiErr) {
      throw new Error(
        `chartgoldprice.com failed (${chartGoldPriceReason}) and GoldAPI.io fallback also failed ` +
          `(${describeProviderError(goldApiErr)}).`,
      );
    }
  }
}

/**
 * Step 8 added this as a routine, read-only accuracy check. Step 9 extends
 * it to also *apply* the result: `tick-fast` prices XAUUSD off Binance's
 * PAXG/USDT ticker, which trades at its own drifting premium/discount
 * ("basis") to real spot gold — this was flagged but left uncorrected back
 * in the Step 2 revision, and turned out to matter enough (owner-reported
 * mismatch against TradingView) to fix. Every 2 minutes: fetch a *fresh*
 * raw Binance price (independent of `instruments.last_price`, which — as of
 * Step 9 — is itself basis-corrected by `tick-fast` and so is no longer a
 * pure raw baseline to compare against) and a calibration reference (Step
 * 10: chartgoldprice.com, falling back to GoldAPI.io — see
 * `fetchCalibrationReference` above), compute the offset between them, and
 * write it to `instruments.price_basis`/`price_basis_at` if it passes a
 * sanity bound (see packages/alert-engine/src/priceBasis.ts) — an outlier
 * reading is logged and skipped, leaving the previous basis in place,
 * rather than letting one bad reading swing the live alert price. `tick`
 * remains the sole writer of `price_basis`/`price_basis_at`, mirroring
 * `tick-fast`'s sole ownership of `last_price`/`last_price_at` — never both
 * from the same function.
 */
async function checkChartGoldPriceAccuracy(
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
    const [reference, rawBinance] = await Promise.all([
      fetchCalibrationReference(),
      new BinanceProvider().getPrice(XAUUSD_SYMBOL),
    ]);

    const basisResult = computePriceBasis(reference.price, rawBinance.price);

    if (basisResult.rejected) {
      console.error(
        `Price basis accuracy check: basis update skipped — ${basisResult.reason} ` +
          `(reference=${reference.price} via ${reference.source}, rawBinance=${rawBinance.price})`,
      );
      return {
        referenceSource: reference.source,
        referencePrice: reference.price,
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
      `Price basis accuracy check: reference=${reference.price} (via ${reference.source}), ` +
        `rawBinance=${rawBinance.price}, basis=${basisResult.basis.toFixed(4)} ` +
        `(${basisResult.deltaPct.toFixed(4)}%)`,
    );

    return {
      referenceSource: reference.source,
      referencePrice: reference.price,
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

  // --- chartgoldprice.com accuracy check: read-only, routine observability
  // only (see handoff/ARCHITECT-BRIEF.md's Step 8). Never writes
  // instruments. ---
  summary.chartGoldPriceCheck = await checkChartGoldPriceAccuracy(supabase);

  return new Response(JSON.stringify(summary), {
    headers: { "content-type": "application/json" },
  });
});
