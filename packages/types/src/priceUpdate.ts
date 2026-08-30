/**
 * A single price tick from a market data provider. Not persisted verbatim —
 * `packages/alert-engine` consumes these, and `instruments.last_price` /
 * `last_price_at` store the latest one per instrument.
 */
export interface PriceUpdate {
  instrument: string; // instrument symbol, e.g. "XAUUSD"
  price: number;
  timestamp: string; // ISO timestamp
  provider: string; // e.g. "OANDA" (Step 2)
}
