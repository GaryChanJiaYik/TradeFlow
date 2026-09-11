import type { PriceUpdate } from "@tradeflow/types";
import type { MarketDataProvider } from "./provider";

/**
 * chartgoldprice.com's public data endpoint. Keyless, no signup, free with
 * attribution only. See handoff/ARCHITECT-BRIEF.md's Step 7 for why this
 * became V1's *primary* XAUUSD source (real spot gold, not a crypto proxy
 * like Binance's PAXG/USDT) with automatic fallback to the already-proven
 * BinanceProvider rather than a hard swap: this service has no named
 * operator and no SLA ("as is, as available," no documented rate limit or
 * uptime guarantee), so it could degrade or disappear without notice.
 */
const CHART_GOLD_PRICE_BASE_URL = "https://www.chartgoldprice.com";

/**
 * If `meta.updated_at` is older than this relative to "now" at call time,
 * the response is treated as a provider failure rather than a stale price
 * silently passed through. The service documents only that it refreshes
 * "on a schedule" with no interval guarantee; 15 minutes is generous
 * relative to our 2-minute poll interval (see the Step 7 brief's Flags —
 * Arch's judgment call).
 */
const STALE_DATA_THRESHOLD_MS = 15 * 60 * 1000;

export type ChartGoldPriceProviderErrorCode =
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_PRICE"
  | "STALE_DATA";

/**
 * Typed error thrown by ChartGoldPriceProvider instead of ever returning/
 * propagating a NaN or stale price. Mirrors BinanceProviderError's pattern
 * exactly so callers can handle both the same way. Callers (in practice,
 * FallbackMarketDataProvider) should catch this, log it, and fall through
 * to the next provider rather than crash the whole cron invocation for one
 * bad tick.
 */
export class ChartGoldPriceProviderError extends Error {
  constructor(
    public readonly code: ChartGoldPriceProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChartGoldPriceProviderError";
  }
}

export interface ChartGoldPriceProviderConfig {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Injectable for tests; defaults to `() => new Date()`. */
  now?: () => Date;
}

/**
 * Shape of the fields this provider actually reads from
 * `GET /api/data`'s response, e.g.
 * `{"meta":{"updated_at":"2026-09-11T12:00:00Z"},"prices":{"gold":{"symbol":"XAU","troy_ounce":4433.33}}}`.
 * Not exhaustive — the real response has more fields under both `meta` and
 * `prices` (e.g. other metals) that this provider doesn't need. Field names
 * are taken verbatim from a real response Arch captured (see the Step 7
 * brief) — not guessed.
 */
interface ChartGoldPriceResponse {
  meta?: {
    updated_at?: string;
  };
  prices?: {
    gold?: {
      symbol?: string;
      troy_ounce?: number;
    };
  };
}

/**
 * MarketDataProvider backed by chartgoldprice.com's public data endpoint:
 * `GET {baseUrl}/api/data`. No API key/secret is needed or read.
 */
export class ChartGoldPriceProvider implements MarketDataProvider {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(config: ChartGoldPriceProviderConfig = {}) {
    this.fetchFn = config.fetchFn ?? fetch;
    this.now = config.now ?? (() => new Date());
  }

  async getPrice(instrument: string): Promise<PriceUpdate> {
    const url = `${CHART_GOLD_PRICE_BASE_URL}/api/data`;

    let response: Response;
    try {
      response = await this.fetchFn(url);
    } catch (err) {
      throw new ChartGoldPriceProviderError(
        "NETWORK_ERROR",
        `chartgoldprice.com data request failed: ${err instanceof Error ? err.message : String(err)}.`,
      );
    }

    if (!response.ok) {
      throw new ChartGoldPriceProviderError(
        "HTTP_ERROR",
        `chartgoldprice.com data request failed with status ${response.status} ${response.statusText}.`,
      );
    }

    let body: ChartGoldPriceResponse;
    try {
      body = (await response.json()) as ChartGoldPriceResponse;
    } catch (err) {
      throw new ChartGoldPriceProviderError(
        "NETWORK_ERROR",
        `chartgoldprice.com response body was not valid JSON: ${err instanceof Error ? err.message : String(err)}.`,
      );
    }

    const price = body.prices?.gold?.troy_ounce;
    const priceIsValid = price !== undefined && Number.isFinite(price);

    if (!priceIsValid) {
      throw new ChartGoldPriceProviderError(
        "INVALID_PRICE",
        `chartgoldprice.com response had a missing or non-numeric "prices.gold.troy_ounce" field.`,
      );
    }

    const updatedAt = body.meta?.updated_at;
    const updatedAtMs = updatedAt ? Date.parse(updatedAt) : NaN;
    if (!Number.isFinite(updatedAtMs)) {
      throw new ChartGoldPriceProviderError(
        "STALE_DATA",
        `chartgoldprice.com response had a missing or unparsable "meta.updated_at" field.`,
      );
    }

    const ageMs = this.now().getTime() - updatedAtMs;
    if (ageMs > STALE_DATA_THRESHOLD_MS) {
      throw new ChartGoldPriceProviderError(
        "STALE_DATA",
        `chartgoldprice.com response is stale: "meta.updated_at" (${updatedAt}) is ${Math.round(
          ageMs / 60000,
        )} minutes old, exceeding the ${STALE_DATA_THRESHOLD_MS / 60000}-minute threshold.`,
      );
    }

    return {
      instrument,
      price,
      timestamp: this.now().toISOString(),
      provider: "CHARTGOLDPRICE",
    };
  }
}
