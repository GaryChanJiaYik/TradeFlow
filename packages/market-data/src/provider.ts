import type { PriceUpdate } from "@tradeflow/types";

/**
 * Contract for any market data source (e.g. OANDA in Step 2). Intentionally
 * defined without an implementation here — a concrete provider needs real
 * credentials and is out of scope for Step 1.
 */
export interface MarketDataProvider {
  /**
   * Fetch the latest price for the given instrument symbol (e.g. "XAUUSD").
   */
  getPrice(instrument: string): Promise<PriceUpdate>;
}
