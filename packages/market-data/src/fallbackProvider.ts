import type { PriceUpdate } from "@tradeflow/types";
import type { MarketDataProvider } from "./provider";

export type FallbackProviderErrorCode = "ALL_PROVIDERS_FAILED";

/**
 * Typed aggregate error thrown by FallbackMarketDataProvider when every
 * wrapped provider fails. Carries every individual provider's thrown error
 * (in the same order the providers were tried) rather than swallowing all
 * but the last one, so a caller/log can see exactly why each source failed.
 *
 * A plain custom class was chosen over the native `AggregateError` to match
 * this codebase's existing convention (BinanceProviderError,
 * OANDAProviderError) of a `<Thing>Error` class with a `code` field callers
 * can `instanceof`/switch on, rather than introducing a different error
 * shape for this one case.
 */
export class FallbackProviderError extends Error {
  constructor(
    public readonly code: FallbackProviderErrorCode,
    message: string,
    public readonly errors: readonly unknown[],
  ) {
    super(message);
    this.name = "FallbackProviderError";
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wraps an ordered list of MarketDataProvider implementations and tries each
 * in turn, falling through to the next on any thrown error. Returns the
 * first success as-is — the winning provider's own `PriceUpdate.provider`
 * field is preserved, so it's always clear from the data itself which
 * source actually supplied a given tick.
 *
 * See handoff/ARCHITECT-BRIEF.md's Step 7: introduced so `ChartGoldPriceProvider`
 * (no SLA, no named operator) can be the primary XAUUSD source without losing
 * the already-proven `BinanceProvider` as a safety net.
 */
export class FallbackMarketDataProvider implements MarketDataProvider {
  constructor(private readonly providers: readonly MarketDataProvider[]) {}

  async getPrice(instrument: string): Promise<PriceUpdate> {
    const errors: unknown[] = [];

    for (const provider of this.providers) {
      try {
        return await provider.getPrice(instrument);
      } catch (err) {
        // provider.constructor.name (e.g. "ChartGoldPriceProvider") is used
        // for the log label since MarketDataProvider is a bare interface
        // with no name/id field of its own — see the Step 7 Builder Plan.
        console.error(`${provider.constructor.name} failed: ${describeError(err)}`);
        errors.push(err);
      }
    }

    throw new FallbackProviderError(
      "ALL_PROVIDERS_FAILED",
      `All ${this.providers.length} market data provider(s) failed for "${instrument}": ${errors
        .map(describeError)
        .join("; ")}`,
      errors,
    );
  }
}
