import { describe, expect, it, vi } from "vitest";
import type { PriceUpdate } from "@tradeflow/types";
import type { MarketDataProvider } from "../provider.js";
import { FallbackMarketDataProvider, FallbackProviderError } from "../fallbackProvider.js";

function makeSuccessProvider(providerName: string, update: Partial<PriceUpdate> = {}): MarketDataProvider {
  return {
    getPrice: vi.fn().mockResolvedValue({
      instrument: "XAUUSD",
      price: 4433.33,
      timestamp: new Date().toISOString(),
      provider: providerName,
      ...update,
    } satisfies PriceUpdate),
  };
}

function makeFailingProvider(error: unknown): MarketDataProvider {
  return {
    getPrice: vi.fn().mockRejectedValue(error),
  };
}

describe("FallbackMarketDataProvider", () => {
  it("returns the primary's result as-is and never calls the fallback when the primary succeeds", async () => {
    const primary = makeSuccessProvider("CHARTGOLDPRICE");
    const secondary = makeSuccessProvider("BINANCE");

    const fallback = new FallbackMarketDataProvider([primary, secondary]);
    const result = await fallback.getPrice("XAUUSD");

    expect(result.provider).toBe("CHARTGOLDPRICE");
    expect(primary.getPrice).toHaveBeenCalledTimes(1);
    expect(secondary.getPrice).not.toHaveBeenCalled();
  });

  it("falls through to the secondary when the primary throws, and logs the failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const primaryError = new Error("primary down");
    const primary = makeFailingProvider(primaryError);
    const secondary = makeSuccessProvider("BINANCE");

    const fallback = new FallbackMarketDataProvider([primary, secondary]);
    const result = await fallback.getPrice("XAUUSD");

    expect(result.provider).toBe("BINANCE");
    expect(secondary.getPrice).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain("primary down");

    consoleErrorSpy.mockRestore();
  });

  it("throws a FallbackProviderError containing every underlying error when all providers fail", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const primaryError = new Error("primary down");
    const secondaryError = new Error("secondary down");
    const primary = makeFailingProvider(primaryError);
    const secondary = makeFailingProvider(secondaryError);

    const fallback = new FallbackMarketDataProvider([primary, secondary]);

    const error = await fallback.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FallbackProviderError);
    const fallbackError = error as FallbackProviderError;
    expect(fallbackError.code).toBe("ALL_PROVIDERS_FAILED");
    expect(fallbackError.errors).toEqual([primaryError, secondaryError]);
    expect(fallbackError.message).toContain("primary down");
    expect(fallbackError.message).toContain("secondary down");
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);

    consoleErrorSpy.mockRestore();
  });
});
