import type { PriceUpdate } from "@tradeflow/types";
import type { MarketDataProvider } from "./provider";

/**
 * GoldAPI.io's public pricing endpoint. Unlike Binance/chartgoldprice.com,
 * this one requires signup and an API token, and its free tier is capped at
 * 100 requests/month — far too low for any hot-path polling. See
 * handoff/ARCHITECT-BRIEF.md's Step 10: this provider exists solely as a
 * low-volume fallback reference for `tick`'s basis calibration when
 * chartgoldprice.com's own staleness/error checks reject a reading, not as
 * a general-purpose price source. Sources from `FOREXCOM:XAUUSD` (a real
 * forex/CFD feed), which is closer to what TradingView's default XAUUSD
 * chart shows than either chartgoldprice.com or Binance's PAXG proxy.
 */
const GOLD_API_BASE_URL = "https://www.goldapi.io";

/**
 * If the response's `timestamp` (unix seconds) is older than this relative
 * to "now" at call time, treat it as a provider failure rather than pass a
 * stale price through as a "fresh" fallback reading. Looser than
 * chartgoldprice.com's 15-minute threshold (`STALE_DATA_THRESHOLD_MS` in
 * chartGoldPriceProvider.ts) because this is only ever called as an
 * infrequent fallback, not polled on a tight cadence — see Step 10.
 */
const STALE_DATA_THRESHOLD_MS = 30 * 60 * 1000;

export type GoldApiProviderErrorCode =
  | "UNKNOWN_INSTRUMENT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_PRICE"
  | "STALE_DATA";

/**
 * Typed error thrown by GoldApiProvider instead of ever returning/
 * propagating a NaN or stale price. Mirrors ChartGoldPriceProviderError's/
 * BinanceProviderError's pattern exactly so callers can handle all three
 * the same way.
 */
export class GoldApiProviderError extends Error {
  constructor(
    public readonly code: GoldApiProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GoldApiProviderError";
  }
}

/**
 * Maps our own `instruments.symbol` values (e.g. "XAUUSD") to GoldAPI.io's
 * `METAL/CURRENCY` path segments. Extend this when a new instrument is
 * added to the `instruments` table.
 */
const SYMBOL_TO_GOLD_API_PATH: Record<string, string> = {
  XAUUSD: "XAU/USD",
};

export interface GoldApiProviderConfig {
  apiKey: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Injectable for tests; defaults to `() => new Date()`. */
  now?: () => Date;
}

/**
 * Shape of the fields this provider actually reads from GoldAPI.io's
 * response, e.g. `{"price": 4733.125, "timestamp": 1776907250}`. Not
 * exhaustive — the real response also has `ask`/`bid`/`price_gram_*`/etc.,
 * which this provider doesn't need (unlike OANDA, GoldAPI.io already
 * returns a single computed `price` field, so there's no bid/ask averaging
 * to do here).
 */
interface GoldApiResponse {
  price?: number;
  timestamp?: number; // unix seconds
}

/**
 * MarketDataProvider backed by GoldAPI.io's real-time pricing endpoint:
 * `GET {baseUrl}/api/{METAL}/{CURRENCY}` with an `x-access-token` header.
 */
export class GoldApiProvider implements MarketDataProvider {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly config: GoldApiProviderConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
    this.now = config.now ?? (() => new Date());
  }

  async getPrice(instrument: string): Promise<PriceUpdate> {
    const path = SYMBOL_TO_GOLD_API_PATH[instrument];
    if (!path) {
      throw new GoldApiProviderError(
        "UNKNOWN_INSTRUMENT",
        `No GoldAPI.io instrument mapping is configured for "${instrument}".`,
      );
    }

    const url = `${GOLD_API_BASE_URL}/api/${path}`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: { "x-access-token": this.config.apiKey },
      });
    } catch (err) {
      throw new GoldApiProviderError(
        "NETWORK_ERROR",
        `GoldAPI.io request failed: ${err instanceof Error ? err.message : String(err)}.`,
      );
    }

    if (!response.ok) {
      throw new GoldApiProviderError(
        "HTTP_ERROR",
        `GoldAPI.io request failed with status ${response.status} ${response.statusText}.`,
      );
    }

    let body: GoldApiResponse;
    try {
      body = (await response.json()) as GoldApiResponse;
    } catch (err) {
      throw new GoldApiProviderError(
        "NETWORK_ERROR",
        `GoldAPI.io response body was not valid JSON: ${err instanceof Error ? err.message : String(err)}.`,
      );
    }

    const price = body.price;
    if (price === undefined || !Number.isFinite(price)) {
      throw new GoldApiProviderError(
        "INVALID_PRICE",
        `GoldAPI.io response had a missing or non-numeric "price" field.`,
      );
    }

    const timestampMs = body.timestamp !== undefined ? body.timestamp * 1000 : NaN;
    if (!Number.isFinite(timestampMs)) {
      throw new GoldApiProviderError(
        "STALE_DATA",
        `GoldAPI.io response had a missing or unparsable "timestamp" field.`,
      );
    }

    const ageMs = this.now().getTime() - timestampMs;
    if (ageMs > STALE_DATA_THRESHOLD_MS) {
      throw new GoldApiProviderError(
        "STALE_DATA",
        `GoldAPI.io response is stale: "timestamp" is ${Math.round(ageMs / 60000)} minutes old, ` +
          `exceeding the ${STALE_DATA_THRESHOLD_MS / 60000}-minute threshold.`,
      );
    }

    return {
      instrument,
      price,
      timestamp: this.now().toISOString(),
      provider: "GOLDAPI",
    };
  }
}
