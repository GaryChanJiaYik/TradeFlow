import type { PriceUpdate } from "@tradeflow/types";
import type { MarketDataProvider } from "./provider";

/**
 * Binance's public market-data mirror. Keyless, no signup, no account —
 * see handoff/ARCHITECT-BRIEF.md's Step 2 revision for why this replaced
 * OANDAProvider as V1's active price source (every broker demo-account
 * signup tried failed for reasons outside our control). Centralized here
 * instead of a literal scattered across the codebase, same rationale as
 * OANDAProvider's OANDA_BASE_URLS.
 */
const BINANCE_BASE_URL = "https://data-api.binance.vision";

/**
 * Maps our own `instruments.symbol` values (e.g. "XAUUSD") to Binance's
 * ticker pair names (e.g. "PAXGUSDT"). Extend this when a new instrument is
 * added to the `instruments` table. Note PAXG is a gold-backed crypto
 * token, not literally spot gold — accepted tradeoff, see the brief.
 */
const SYMBOL_TO_BINANCE_PAIR: Record<string, string> = {
  XAUUSD: "PAXGUSDT",
};

export type BinanceProviderErrorCode = "UNKNOWN_INSTRUMENT" | "HTTP_ERROR" | "INVALID_PRICE";

/**
 * Typed error thrown by BinanceProvider instead of ever returning/propagating
 * a NaN price. Callers (the tick Edge Function) should catch this and log a
 * failure rather than crash the whole cron invocation for one bad tick.
 */
export class BinanceProviderError extends Error {
  constructor(
    public readonly code: BinanceProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BinanceProviderError";
  }
}

export interface BinanceProviderConfig {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
}

/**
 * Shape of the fields this provider actually reads from Binance's
 * `GET /api/v3/ticker/price` response, e.g.
 * `{"symbol":"PAXGUSDT","price":"4433.33000000"}`.
 */
interface BinanceTickerPriceResponse {
  symbol?: string;
  price?: string;
}

/**
 * MarketDataProvider backed by Binance's public ticker endpoint:
 * `GET {baseUrl}/api/v3/ticker/price?symbol=<pair>`. No API key/secret is
 * needed or read — this is a public market-data endpoint.
 */
export class BinanceProvider implements MarketDataProvider {
  private readonly fetchFn: typeof fetch;

  constructor(config: BinanceProviderConfig = {}) {
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async getPrice(instrument: string): Promise<PriceUpdate> {
    const binancePair = SYMBOL_TO_BINANCE_PAIR[instrument];
    if (!binancePair) {
      throw new BinanceProviderError(
        "UNKNOWN_INSTRUMENT",
        `No Binance pair mapping is configured for "${instrument}".`,
      );
    }

    const url = `${BINANCE_BASE_URL}/api/v3/ticker/price?symbol=${binancePair}`;
    const response = await this.fetchFn(url);

    if (!response.ok) {
      throw new BinanceProviderError(
        "HTTP_ERROR",
        `Binance ticker request failed with status ${response.status} ${response.statusText}.`,
      );
    }

    const body = (await response.json()) as BinanceTickerPriceResponse;
    const price = Number(body.price);
    const priceIsValid = body.price !== undefined && Number.isFinite(price);

    if (!priceIsValid) {
      throw new BinanceProviderError(
        "INVALID_PRICE",
        `Binance ticker response had a missing or non-numeric "price" field for "${binancePair}".`,
      );
    }

    return {
      instrument,
      price,
      timestamp: new Date().toISOString(),
      provider: "BINANCE",
    };
  }
}
