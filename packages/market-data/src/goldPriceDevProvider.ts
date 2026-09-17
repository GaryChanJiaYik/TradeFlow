import type { PriceUpdate } from "@tradeflow/types";
import type { MarketDataProvider } from "./provider";

/**
 * goldprice.dev's live-prices endpoint. Keyless, no signup — the API lives
 * on a separate subdomain (`api.goldprice.dev`) from the marketing site
 * (`goldprice.dev`), confirmed against its real docs, not guessed. Free/
 * anonymous tier: 100 requests/hour/IP, comfortably above `tick`'s 2-minute
 * poll cadence (30/hour). Replaces ChartGoldPriceProvider (Step 9/10) as
 * `tick`'s calibration reference as of Step 12 — chartgoldprice.com was
 * observed stale for 8+ hours at a time on three separate occasions across
 * this project's history (see handoff/BUILD-LOG.md), while this service
 * self-reports freshness via `is_stale` and was verified live with a
 * sub-second-old `computed_at` at the time this provider was written.
 * `ChartGoldPriceProvider` itself is left in place, unused — same
 * leave-it-in-place-unwired convention as `OANDAProvider`/
 * `FallbackMarketDataProvider`.
 */
const GOLD_PRICE_DEV_BASE_URL = "https://api.goldprice.dev/v1";

/**
 * Backstop against the API's own `is_stale` flag, not a replacement for it:
 * `computed_at` older than this relative to "now" at call time is treated
 * as a provider failure even if `is_stale` somehow says otherwise. The
 * service documents ~60s refresh; 5 minutes is generous relative to
 * `tick`'s 2-minute poll interval while still catching a genuinely broken
 * response, mirroring the "never trust a single external signal blindly"
 * pattern `ChartGoldPriceProvider` already established.
 */
const STALE_DATA_THRESHOLD_MS = 5 * 60 * 1000;

export type GoldPriceDevProviderErrorCode =
  | "UNKNOWN_INSTRUMENT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_PRICE"
  | "STALE_DATA";

/**
 * Typed error thrown by GoldPriceDevProvider instead of ever returning/
 * propagating a NaN or stale price. Mirrors ChartGoldPriceProviderError's/
 * BinanceProviderError's pattern exactly so callers can handle all three
 * the same way.
 */
export class GoldPriceDevProviderError extends Error {
  constructor(
    public readonly code: GoldPriceDevProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GoldPriceDevProviderError";
  }
}

/**
 * Maps our own `instruments.symbol` values (e.g. "XAUUSD") to goldprice.dev's
 * `symbol` query parameter. Extend this when a new instrument is added to
 * the `instruments` table.
 */
const SYMBOL_TO_GOLD_PRICE_DEV_QUERY: Record<string, string> = {
  XAUUSD: "XAU-USD-SPOT",
};

export interface GoldPriceDevProviderConfig {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Injectable for tests; defaults to `() => new Date()`. */
  now?: () => Date;
}

/**
 * Shape of the fields this provider actually reads from goldprice.dev's
 * response, e.g.
 * `{"symbols":[{"symbol":"XAU","price":"4308.55","is_stale":false,"computed_at":"2026-09-17T06:10:07.736922Z"}]}`.
 * Not exhaustive — the real response also has `quote_currency`, `unit`,
 * `contract_type`, which this provider doesn't need. `price` is a string in
 * the real response, not a number — parsed explicitly below, never trusted
 * as already-numeric.
 */
interface GoldPriceDevSymbolEntry {
  symbol?: string;
  price?: string;
  is_stale?: boolean;
  computed_at?: string;
}

interface GoldPriceDevResponse {
  symbols?: GoldPriceDevSymbolEntry[];
}

/**
 * MarketDataProvider backed by goldprice.dev's live pricing endpoint:
 * `GET {baseUrl}/prices?symbol=<query>`. No API key needed or read.
 */
export class GoldPriceDevProvider implements MarketDataProvider {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(config: GoldPriceDevProviderConfig = {}) {
    this.fetchFn = config.fetchFn ?? fetch;
    this.now = config.now ?? (() => new Date());
  }

  async getPrice(instrument: string): Promise<PriceUpdate> {
    const query = SYMBOL_TO_GOLD_PRICE_DEV_QUERY[instrument];
    if (!query) {
      throw new GoldPriceDevProviderError(
        "UNKNOWN_INSTRUMENT",
        `No goldprice.dev instrument mapping is configured for "${instrument}".`,
      );
    }

    const url = `${GOLD_PRICE_DEV_BASE_URL}/prices?symbol=${query}`;

    let response: Response;
    try {
      response = await this.fetchFn(url);
    } catch (err) {
      throw new GoldPriceDevProviderError(
        "NETWORK_ERROR",
        `goldprice.dev request failed: ${err instanceof Error ? err.message : String(err)}.`,
      );
    }

    if (!response.ok) {
      throw new GoldPriceDevProviderError(
        "HTTP_ERROR",
        `goldprice.dev request failed with status ${response.status} ${response.statusText}.`,
      );
    }

    let body: GoldPriceDevResponse;
    try {
      body = (await response.json()) as GoldPriceDevResponse;
    } catch (err) {
      throw new GoldPriceDevProviderError(
        "NETWORK_ERROR",
        `goldprice.dev response body was not valid JSON: ${err instanceof Error ? err.message : String(err)}.`,
      );
    }

    const entry = body.symbols?.find((s) => s.symbol === "XAU");
    if (!entry) {
      throw new GoldPriceDevProviderError(
        "INVALID_PRICE",
        `goldprice.dev response had no "XAU" entry in "symbols".`,
      );
    }

    const price = entry.price !== undefined ? Number(entry.price) : NaN;
    if (!Number.isFinite(price)) {
      throw new GoldPriceDevProviderError(
        "INVALID_PRICE",
        `goldprice.dev response had a missing or non-numeric "price" field.`,
      );
    }

    if (entry.is_stale === true) {
      throw new GoldPriceDevProviderError(
        "STALE_DATA",
        `goldprice.dev response is self-reported stale (is_stale: true).`,
      );
    }

    const computedAtMs = entry.computed_at ? Date.parse(entry.computed_at) : NaN;
    if (!Number.isFinite(computedAtMs)) {
      throw new GoldPriceDevProviderError(
        "STALE_DATA",
        `goldprice.dev response had a missing or unparsable "computed_at" field.`,
      );
    }

    const ageMs = this.now().getTime() - computedAtMs;
    if (ageMs > STALE_DATA_THRESHOLD_MS) {
      throw new GoldPriceDevProviderError(
        "STALE_DATA",
        `goldprice.dev response is stale: "computed_at" (${entry.computed_at}) is ${Math.round(
          ageMs / 60000,
        )} minutes old, exceeding the ${STALE_DATA_THRESHOLD_MS / 60000}-minute threshold ` +
          `(despite is_stale: false).`,
      );
    }

    return {
      instrument,
      price,
      timestamp: this.now().toISOString(),
      provider: "GOLDPRICEDEV",
    };
  }
}
