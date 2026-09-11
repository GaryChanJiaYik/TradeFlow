import { describe, expect, it, vi } from "vitest";
import { ChartGoldPriceProvider, ChartGoldPriceProviderError } from "../chartGoldPriceProvider.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

/** Fixed "now" used across tests; updated_at fixtures are expressed relative to it. */
const NOW = new Date("2026-09-11T12:00:00.000Z");

function freshBody(overrides: { updatedAt?: string; troyOunce?: unknown } = {}) {
  return {
    meta: { updated_at: overrides.updatedAt ?? NOW.toISOString() },
    prices: { gold: { symbol: "XAU", troy_ounce: overrides.troyOunce ?? 4433.33 } },
  };
}

describe("ChartGoldPriceProvider", () => {
  it("parses a successful, fresh response into a PriceUpdate", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, freshBody()));
    const provider = new ChartGoldPriceProvider({ fetchFn, now: () => NOW });

    const result = await provider.getPrice("XAUUSD");

    expect(result.instrument).toBe("XAUUSD");
    expect(result.provider).toBe("CHARTGOLDPRICE");
    expect(result.price).toBeCloseTo(4433.33, 5);
    expect(result.timestamp).toBe(NOW.toISOString());

    const [url] = fetchFn.mock.calls[0] as [string];
    expect(url).toBe("https://www.chartgoldprice.com/api/data");
  });

  it("throws ChartGoldPriceProviderError with NETWORK_ERROR when fetch itself rejects", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const provider = new ChartGoldPriceProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChartGoldPriceProviderError);
    expect((error as ChartGoldPriceProviderError).code).toBe("NETWORK_ERROR");
    expect((error as ChartGoldPriceProviderError).message).toContain("fetch failed");
  });

  it("throws ChartGoldPriceProviderError with NETWORK_ERROR on a non-JSON response body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("<html>not json</html>", { status: 200, statusText: "OK" }),
    );
    const provider = new ChartGoldPriceProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChartGoldPriceProviderError);
    expect((error as ChartGoldPriceProviderError).code).toBe("NETWORK_ERROR");
  });

  it("throws ChartGoldPriceProviderError on an HTTP error status", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(503, { msg: "Unavailable" }));
    const provider = new ChartGoldPriceProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChartGoldPriceProviderError);
    expect((error as ChartGoldPriceProviderError).code).toBe("HTTP_ERROR");
  });

  it("throws ChartGoldPriceProviderError (never NaN) on a missing troy_ounce field", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { meta: { updated_at: NOW.toISOString() }, prices: { gold: {} } }),
    );
    const provider = new ChartGoldPriceProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChartGoldPriceProviderError);
    expect((error as ChartGoldPriceProviderError).code).toBe("INVALID_PRICE");
  });

  it("throws ChartGoldPriceProviderError (never NaN) on a non-numeric troy_ounce field", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, freshBody({ troyOunce: "not-a-number" })));
    const provider = new ChartGoldPriceProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChartGoldPriceProviderError);
    expect((error as ChartGoldPriceProviderError).code).toBe("INVALID_PRICE");
  });

  it("throws ChartGoldPriceProviderError with STALE_DATA when updated_at is missing", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { meta: {}, prices: { gold: { troy_ounce: 4433.33 } } }),
    );
    const provider = new ChartGoldPriceProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChartGoldPriceProviderError);
    expect((error as ChartGoldPriceProviderError).code).toBe("STALE_DATA");
  });

  it("throws ChartGoldPriceProviderError with STALE_DATA when updated_at is more than 15 minutes old", async () => {
    const staleUpdatedAt = new Date(NOW.getTime() - 16 * 60 * 1000).toISOString();
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, freshBody({ updatedAt: staleUpdatedAt })));
    const provider = new ChartGoldPriceProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChartGoldPriceProviderError);
    expect((error as ChartGoldPriceProviderError).code).toBe("STALE_DATA");
  });

  it("accepts data exactly at the 15-minute-old boundary (not yet stale)", async () => {
    const boundaryUpdatedAt = new Date(NOW.getTime() - 15 * 60 * 1000).toISOString();
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, freshBody({ updatedAt: boundaryUpdatedAt })));
    const provider = new ChartGoldPriceProvider({ fetchFn, now: () => NOW });

    const result = await provider.getPrice("XAUUSD");
    expect(result.price).toBeCloseTo(4433.33, 5);
  });

  it("defaults to the global fetch when no fetchFn is injected", () => {
    expect(() => new ChartGoldPriceProvider()).not.toThrow();
  });
});
