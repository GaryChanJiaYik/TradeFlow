// TradeFlow — "mt4-webhook" Edge Function (Deno). Step 11's first *inbound*
// webhook: unlike `tick`/`tick-fast` (pg_cron-triggered, bearer-authed with
// the service-role key — itself a valid project JWT) or the Next.js app
// (a logged-in browser session under RLS), this is called directly by a
// custom MQL4 EA running on the owner's own free VPS, which has neither.
// See handoff/ARCHITECT-BRIEF.md's Step 11 Decisions.
//
// IMPORTANT DEPLOYMENT PREREQUISITE: this function's `verify_jwt` must be
// disabled in supabase/config.toml (`[functions.mt4-webhook]` /
// `verify_jwt = false`) — the EA has no project-signed JWT to present, so
// with the platform's default JWT gateway check left on, every request
// would be rejected before this file's own code (including the
// `x-webhook-secret` check below) ever runs. With verify_jwt off, that
// shared secret is the ONLY auth layer for this function, not a second one
// on top of the gateway — be deliberate about keeping it a real secret.
//
// Two payload shapes, discriminated by `type` (one endpoint, not two — MT4's
// WebRequest() allow-list is a manual, GUI-only, one-URL-at-a-time step, so
// collapsing to a single URL matters):
//   { type: "PRICE_TICK", symbol, price, time? }
//   { type: "ORDER_FILLED", ticket, symbol, orderType: "BUY"|"SELL", volume, price, time? }
//
// PRICE_TICK becomes the primary source for instruments.last_price whenever
// it's fresh (see tick-fast/index.ts's `isMt4Fresh`) — no price-basis
// correction here, unlike Binance: MT4/TMGM is already the real broker
// price the basis correction exists to approximate. ORDER_FILLED sends an
// immediate push notification — the owner places orders manually/elsewhere,
// not via this EA, so this is purely a notify path, never a trading action.
//
// Uses the Supabase **service role** client — same rationale as `tick`/
// `tick-fast` (no logged-in user here either; RLS is bypassed by design).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import type { Instrument } from "@tradeflow/types";
import { processPriceAlerts } from "../_shared/processPriceAlerts.ts";
import { configureWebPush, getRequiredEnv, logNotification, pushToUserDevices } from "../_shared/notifications.ts";

const XAUUSD_SYMBOL = "XAUUSD";

interface PriceTickPayload {
  type: "PRICE_TICK";
  symbol: string;
  price: number;
}

interface OrderFilledPayload {
  type: "ORDER_FILLED";
  ticket: number;
  symbol: string;
  orderType: "BUY" | "SELL";
  volume: number;
  price: number;
}

type WebhookPayload = PriceTickPayload | OrderFilledPayload;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parsePayload(body: unknown): WebhookPayload | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;

  if (record.type === "PRICE_TICK") {
    if (typeof record.symbol !== "string" || !Number.isFinite(record.price)) return null;
    return { type: "PRICE_TICK", symbol: record.symbol, price: record.price as number };
  }

  if (record.type === "ORDER_FILLED") {
    if (
      typeof record.symbol !== "string" ||
      !Number.isFinite(record.ticket) ||
      (record.orderType !== "BUY" && record.orderType !== "SELL") ||
      !Number.isFinite(record.volume) ||
      !Number.isFinite(record.price)
    ) {
      return null;
    }
    return {
      type: "ORDER_FILLED",
      ticket: record.ticket as number,
      symbol: record.symbol,
      orderType: record.orderType,
      volume: record.volume as number,
      price: record.price as number,
    };
  }

  return null;
}

Deno.serve(async (req: Request) => {
  const expectedSecret = getRequiredEnv("MT4_WEBHOOK_SECRET");
  const providedSecret = req.headers.get("x-webhook-secret");
  if (!providedSecret || providedSecret !== expectedSecret) {
    return jsonResponse(401, { ok: false, error: "unauthorized" });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid JSON body" });
  }

  const payload = parsePayload(body);
  if (!payload) {
    return jsonResponse(400, { ok: false, error: "malformed or unrecognized payload" });
  }

  const now = new Date();
  const supabase = createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
  configureWebPush();

  if (payload.type === "PRICE_TICK") {
    const { data: instrument, error: instrumentError } = await supabase
      .from("instruments")
      .select("*")
      .eq("symbol", payload.symbol)
      .eq("enabled", true)
      .maybeSingle<Instrument>();

    if (instrumentError || !instrument) {
      return jsonResponse(404, { ok: false, error: `instrument "${payload.symbol}" not found or disabled` });
    }

    const priceAlerts = await processPriceAlerts(supabase, instrument, payload.price, now);

    // Unconditionally seed the baseline (even with zero triggers) so the
    // next invocation — from either this webhook or tick-fast's fallback —
    // has a correct "previous price." This function and `tick-fast` are the
    // only writers of last_price/last_price_at; tick-fast's freshness gate
    // (isMt4Fresh) ensures only one of them is active in a given window.
    const { error: updateError } = await supabase
      .from("instruments")
      .update({
        last_price: payload.price,
        last_price_at: now.toISOString(),
        mt4_last_seen_at: now.toISOString(),
        price_source: "MT4",
      })
      .eq("id", instrument.id);
    if (updateError) {
      console.error(`Failed to update instrument ${instrument.id} from MT4 tick:`, updateError);
    }

    return jsonResponse(200, { ok: true, type: "PRICE_TICK", priceAlerts });
  }

  // ORDER_FILLED
  const userId = getRequiredEnv("MT4_WEBHOOK_USER_ID");
  const title = `${payload.symbol} Order Filled`;
  const message = `${payload.orderType} ${payload.volume} ${payload.symbol} filled at ${payload.price} (ticket ${payload.ticket}).`;

  const push = await pushToUserDevices(supabase, userId, {
    title,
    body: message,
    eventType: "ORDER_FILLED",
    ticket: payload.ticket,
  });
  await logNotification(supabase, { userId, eventType: "ORDER_FILLED", title, message, push });

  return jsonResponse(200, { ok: true, type: "ORDER_FILLED", push });
});
