import { describe, expect, it, vi } from "vitest";
import { BinanceProvider, BinanceProviderError } from "../binanceProvider.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

describe("BinanceProvider", () => {
  it("parses a successful response into a PriceUpdate", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { symbol: "PAXGUSDT", price: "4433.33000000" }),
    );

    const provider = new BinanceProvider({ fetchFn });
    const result = await provider.getPrice("XAUUSD");

    expect(result.instrument).toBe("XAUUSD");
    expect(result.provider).toBe("BINANCE");
    expect(result.price).toBeCloseTo(4433.33, 5);
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();

    const [url] = fetchFn.mock.calls[0] as [string];
    expect(url).toBe("https://data-api.binance.vision/api/v3/ticker/price?symbol=PAXGUSDT");
  });

  it("throws BinanceProviderError on an HTTP error status", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(451, { msg: "Unavailable" }));
    const provider = new BinanceProvider({ fetchFn });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BinanceProviderError);
    expect((error as BinanceProviderError).code).toBe("HTTP_ERROR");
  });

  it("throws BinanceProviderError (never NaN) on a missing price field", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { symbol: "PAXGUSDT" }));
    const provider = new BinanceProvider({ fetchFn });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BinanceProviderError);
    expect((error as BinanceProviderError).code).toBe("INVALID_PRICE");
  });

  it("throws BinanceProviderError (never NaN) on a non-numeric price field", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { symbol: "PAXGUSDT", price: "not-a-number" }),
    );
    const provider = new BinanceProvider({ fetchFn });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BinanceProviderError);
    expect((error as BinanceProviderError).code).toBe("INVALID_PRICE");
  });

  it("throws BinanceProviderError for an instrument with no Binance mapping", async () => {
    const fetchFn = vi.fn();
    const provider = new BinanceProvider({ fetchFn });

    const error = await provider.getPrice("UNKNOWN_SYMBOL").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BinanceProviderError);
    expect((error as BinanceProviderError).code).toBe("UNKNOWN_INSTRUMENT");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("defaults to the global fetch when no fetchFn is injected", () => {
    expect(() => new BinanceProvider()).not.toThrow();
  });
});
