// TradeFlow — "tick-fast" Edge Function (Deno). Invoked every 10 seconds by
// pg_cron (see supabase/migrations/0005_tick_fast_cron.sql) via pg_net. As of
// Step 11, this is the FALLBACK path: if `mt4-webhook` has reported a real
// TMGM/MT4 broker tick recently (`instruments.mt4_last_seen_at` within
// `MT4_FRESHNESS_SECONDS`), this invocation skips entirely — see
// `isMt4Fresh` below and handoff/ARCHITECT-BRIEF.md's Step 11. Otherwise it
// falls back to Binance's public PAXG/USDT ticker (no further fallback below
// that — see Step 8), corrects it against real spot gold using the basis
// `tick` calibrates every 2 minutes from goldprice.dev (Step 9, source
// swapped from chartgoldprice.com in Step 12 — see
// packages/alert-engine/src/priceBasis.ts), evaluates the corrected price
// against every enabled/unexpired price_alerts row, sends Web Push
// notifications for anything that fires, and unconditionally updates
// instruments.last_price/last_price_at (the corrected price) on a
// successful fetch. This function and `mt4-webhook` are the only writers of
// that baseline — exactly one of them is ever active in a given window,
// chosen by freshness. Neither ever reads or writes graph_reminders (that
// stays exclusively in `tick`).
//
// Split out of `tick/index.ts` as a separate function (not a branching flag
// in the same file) specifically so this hot 10-second path never shares a
// file with Step 6/7's already-reviewed reminder/hardening logic, and so it
// gets its own invocation/duration metrics. See handoff/ARCHITECT-BRIEF.md
// Step 8 Decisions — do not collapse this back into `tick`.
//
// Uses the Supabase **service role** client — same rationale as `tick`
// (no logged-in user in a cron context; RLS is bypassed by design here).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import type { Instrument } from "@tradeflow/types";
import { BinanceProvider } from "../../../packages/market-data/src/binanceProvider.ts";
import { applyPriceBasis } from "../../../packages/alert-engine/src/priceBasis.ts";
import { processPriceAlerts } from "../_shared/processPriceAlerts.ts";
import {
  configureWebPush,
  describeProviderError,
  getRequiredEnv,
} from "../_shared/notifications.ts";

const XAUUSD_SYMBOL = "XAUUSD";

/**
 * Step 11: `mt4-webhook` becomes the primary XAUUSD price source whenever
 * it's fresh (a real broker tick from the owner's own TMGM/MT4 account is
 * more accurate than Binance's PAXG proxy, and doesn't need the price-basis
 * correction below). `instruments.mt4_last_seen_at` is written only by
 * `mt4-webhook`, using that function's own server clock — never the EA's
 * self-reported timestamp — so this check never has to trust a flaky VPS's
 * clock. Configurable via `MT4_FRESHNESS_SECONDS` (default 25s: tick-fast
 * runs every 10s and the EA heartbeats every 5s, so 25s tolerates two
 * consecutive missed heartbeats before falling back). See
 * handoff/ARCHITECT-BRIEF.md's Step 11 Decisions.
 */
function isMt4Fresh(instrument: Pick<Instrument, "mt4_last_seen_at">, now: Date): boolean {
  const freshnessMs = Number(Deno.env.get("MT4_FRESHNESS_SECONDS") ?? "25") * 1000;
  if (!instrument.mt4_last_seen_at) return false;
  const lastSeenMs = new Date(instrument.mt4_last_seen_at).getTime();
  return now.getTime() - lastSeenMs < freshnessMs;
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

  if (isMt4Fresh(instrument, now)) {
    // Step 11: exactly one active evaluator at a time, chosen by freshness —
    // not just one active writer. Skip the Binance fetch, alert evaluation,
    // AND the last_price write entirely (not just the write) so the same
    // crossing is never evaluated twice against two different price
    // streams in the same window. `mt4-webhook` already did all of this
    // against the real broker tick.
    summary.priceAlerts = {
      skipped: true,
      reason: "MT4 is the fresh primary source; Binance fallback not needed this tick",
    };
    return new Response(JSON.stringify(summary), {
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const provider = new BinanceProvider();
    const tick = await provider.getPrice(instrument.symbol);

    // Step 9: correct the raw Binance PAXG price for its drifting
    // premium/discount against real spot gold, using the basis `tick`
    // calibrates every 2 minutes from goldprice.dev (source swapped from
    // chartgoldprice.com in Step 12 — see
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
    // function and `mt4-webhook` are the only writers of
    // instruments.last_price/last_price_at (`tick`, narrowed since Step 8,
    // never touches it) — the freshness gate above ensures only one of them
    // is active in a given window. A failure here just delays detection by
    // one tick (self-corrects in 10s) — logged for visibility, no retry
    // logic needed.
    const { error: instrumentUpdateError } = await supabase
      .from("instruments")
      .update({ last_price: correctedPrice, last_price_at: tick.timestamp, price_source: "BINANCE" })
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
