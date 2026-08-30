import type { PriceUpdate } from "@tradeflow/types";
import type { MarketDataProvider } from "./provider";

/**
 * OANDA v20 supports "practice" (demo) and "live" environments. V1 only
 * ever runs against practice (see handoff/ARCHITECT-BRIEF.md Step 2) — the
 * base URL is centralized here instead of a literal scattered across the
 * codebase so a "live" entry can be added later without a repo-wide
 * search-and-replace. Do not add a "live" code path until V1 actually needs
 * one.
 */
const OANDA_BASE_URLS = {
  practice: "https://api-fxpractice.oanda.com",
} as const;

export type OANDAEnvironment = keyof typeof OANDA_BASE_URLS;

/**
 * Maps our own `instruments.symbol` values (e.g. "XAUUSD") to OANDA's
 * underscored v20 instrument names (e.g. "XAU_USD"). Extend this when a new
 * instrument is added to the `instruments` table.
 */
const SYMBOL_TO_OANDA_INSTRUMENT: Record<string, string> = {
  XAUUSD: "XAU_USD",
};

export type OANDAProviderErrorCode =
  | "UNKNOWN_INSTRUMENT"
  | "HTTP_ERROR"
  | "EMPTY_PRICES"
  | "INVALID_PRICE";

/**
 * Typed error thrown by OANDAProvider instead of ever returning/propagating
 * a NaN price. Callers (the tick Edge Function) should catch this and log a
 * failure rather than crash the whole cron invocation for one bad tick.
 */
export class OANDAProviderError extends Error {
  constructor(
    public readonly code: OANDAProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OANDAProviderError";
  }
}

export interface OANDAProviderConfig {
  apiToken: string;
  accountId: string;
  environment: OANDAEnvironment;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
}

/**
 * Shape of the fields this provider actually reads from OANDA's v20
 * `ClientPrice` object (developer.oanda.com/rest-live-v20/pricing-df/ and
 * pricing-common-df/). Not exhaustive — OANDA also returns `bids`, `asks`,
 * `tradeable`, `status`, `unitsAvailable`, etc., which this provider does
 * not need.
 *
 * Field choice: `closeoutBid`/`closeoutAsk` (scalars) are used instead of
 * `bids[0].price`/`asks[0].price` (arrays) because OANDA's own docs say the
 * `bids`/`asks` arrays can legitimately be empty when there's no liquidity
 * on that side, whereas `closeoutBid`/`closeoutAsk` are fallback scalars
 * specifically designed to always be present in that case (they exist so a
 * closeout price is always computable). This app only needs a reliable
 * reference price to compare against alert thresholds — it never opens or
 * closes a real position — so the always-present fields are the better fit.
 */
interface OANDAClientPrice {
  instrument?: string;
  closeoutBid?: string;
  closeoutAsk?: string;
}

interface OANDAPricingResponse {
  prices?: OANDAClientPrice[];
}

/**
 * MarketDataProvider backed by OANDA's v20 REST pricing endpoint:
 * `GET {baseUrl}/v3/accounts/{accountID}/pricing?instruments=<name>`.
 */
export class OANDAProvider implements MarketDataProvider {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: OANDAProviderConfig) {
    this.baseUrl = OANDA_BASE_URLS[config.environment];
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async getPrice(instrument: string): Promise<PriceUpdate> {
    const oandaInstrument = SYMBOL_TO_OANDA_INSTRUMENT[instrument];
    if (!oandaInstrument) {
      throw new OANDAProviderError(
        "UNKNOWN_INSTRUMENT",
        `No OANDA instrument mapping is configured for "${instrument}".`,
      );
    }

    const url = `${this.baseUrl}/v3/accounts/${this.config.accountId}/pricing?instruments=${oandaInstrument}`;
    const response = await this.fetchFn(url, {
      headers: { Authorization: `Bearer ${this.config.apiToken}` },
    });

    if (!response.ok) {
      throw new OANDAProviderError(
        "HTTP_ERROR",
        `OANDA pricing request failed with status ${response.status} ${response.statusText}.`,
      );
    }

    const body = (await response.json()) as OANDAPricingResponse;
    const priceEntry = body.prices?.[0];
    if (!priceEntry) {
      throw new OANDAProviderError(
        "EMPTY_PRICES",
        `OANDA pricing response contained no entries for "${oandaInstrument}".`,
      );
    }

    const bid = Number(priceEntry.closeoutBid);
    const ask = Number(priceEntry.closeoutAsk);
    const bidIsValid = priceEntry.closeoutBid !== undefined && Number.isFinite(bid);
    const askIsValid = priceEntry.closeoutAsk !== undefined && Number.isFinite(ask);

    if (!bidIsValid || !askIsValid) {
      throw new OANDAProviderError(
        "INVALID_PRICE",
        `OANDA pricing response had a missing or non-numeric closeoutBid/closeoutAsk for "${oandaInstrument}".`,
      );
    }

    return {
      instrument,
      price: (bid + ask) / 2,
      timestamp: new Date().toISOString(),
      provider: "OANDA",
    };
  }
}
