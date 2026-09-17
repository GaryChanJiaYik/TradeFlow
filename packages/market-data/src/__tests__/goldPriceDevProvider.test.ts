import { describe, expect, it, vi } from "vitest";
import { GoldPriceDevProvider, GoldPriceDevProviderError } from "../goldPriceDevProvider.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

/** Fixed "now" used across tests; computed_at fixtures are expressed relative to it. */
const NOW = new Date("2026-09-17T06:10:08.000Z");

function freshBody(overrides: { computedAt?: string; price?: unknown; isStale?: boolean } = {}) {
  return {
    symbols: [
      {
        symbol: "XAU",
        quote_currency: "USD",
        price: overrides.price ?? "4308.55",
        is_stale: overrides.isStale ?? false,
        computed_at: overrides.computedAt ?? NOW.toISOString(),
      },
    ],
  };
}

describe("GoldPriceDevProvider", () => {
  it("parses a successful, fresh response into a PriceUpdate", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, freshBody()));
    const provider = new GoldPriceDevProvider({ fetchFn, now: () => NOW });

    const result = await provider.getPrice("XAUUSD");

    expect(result.instrument).toBe("XAUUSD");
    expect(result.provider).toBe("GOLDPRICEDEV");
    expect(result.price).toBeCloseTo(4308.55, 5);
    expect(result.timestamp).toBe(NOW.toISOString());

    const [url] = fetchFn.mock.calls[0] as [string];
    expect(url).toBe("https://api.goldprice.dev/v1/prices?symbol=XAU-USD-SPOT");
  });

  it("throws GoldPriceDevProviderError with UNKNOWN_INSTRUMENT for an unmapped symbol (no fetch made)", async () => {
    const fetchFn = vi.fn();
    const provider = new GoldPriceDevProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("EURUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldPriceDevProviderError);
    expect((error as GoldPriceDevProviderError).code).toBe("UNKNOWN_INSTRUMENT");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws GoldPriceDevProviderError with NETWORK_ERROR when fetch itself rejects", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const provider = new GoldPriceDevProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldPriceDevProviderError);
    expect((error as GoldPriceDevProviderError).code).toBe("NETWORK_ERROR");
    expect((error as GoldPriceDevProviderError).message).toContain("fetch failed");
  });

  it("throws GoldPriceDevProviderError with NETWORK_ERROR on a non-JSON response body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("<html>not json</html>", { status: 200, statusText: "OK" }));
    const provider = new GoldPriceDevProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldPriceDevProviderError);
    expect((error as GoldPriceDevProviderError).code).toBe("NETWORK_ERROR");
  });

  it("throws GoldPriceDevProviderError on an HTTP error status", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(503, { msg: "Unavailable" }));
    const provider = new GoldPriceDevProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldPriceDevProviderError);
    expect((error as GoldPriceDevProviderError).code).toBe("HTTP_ERROR");
  });

  it("throws GoldPriceDevProviderError (never NaN) on a missing XAU entry", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { symbols: [] }));
    const provider = new GoldPriceDevProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldPriceDevProviderError);
    expect((error as GoldPriceDevProviderError).code).toBe("INVALID_PRICE");
  });

  it("throws GoldPriceDevProviderError (never NaN) on a non-numeric price field", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, freshBody({ price: "not-a-number" })));
    const provider = new GoldPriceDevProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldPriceDevProviderError);
    expect((error as GoldPriceDevProviderError).code).toBe("INVALID_PRICE");
  });

  it("throws GoldPriceDevProviderError with STALE_DATA when is_stale is true, even with a fresh computed_at", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, freshBody({ isStale: true })));
    const provider = new GoldPriceDevProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldPriceDevProviderError);
    expect((error as GoldPriceDevProviderError).code).toBe("STALE_DATA");
    expect((error as GoldPriceDevProviderError).message).toContain("is_stale");
  });

  it("throws GoldPriceDevProviderError with STALE_DATA when computed_at is missing", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { symbols: [{ symbol: "XAU", price: "4308.55", is_stale: false }] }),
    );
    const provider = new GoldPriceDevProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldPriceDevProviderError);
    expect((error as GoldPriceDevProviderError).code).toBe("STALE_DATA");
  });

  it("throws GoldPriceDevProviderError with STALE_DATA when computed_at is more than 5 minutes old, even if is_stale says false", async () => {
    const staleComputedAt = new Date(NOW.getTime() - 6 * 60 * 1000).toISOString();
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, freshBody({ computedAt: staleComputedAt })));
    const provider = new GoldPriceDevProvider({ fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldPriceDevProviderError);
    expect((error as GoldPriceDevProviderError).code).toBe("STALE_DATA");
    expect((error as GoldPriceDevProviderError).message).toContain("despite is_stale: false");
  });

  it("accepts data exactly at the 5-minute-old boundary (not yet stale)", async () => {
    const boundaryComputedAt = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, freshBody({ computedAt: boundaryComputedAt })));
    const provider = new GoldPriceDevProvider({ fetchFn, now: () => NOW });

    const result = await provider.getPrice("XAUUSD");
    expect(result.price).toBeCloseTo(4308.55, 5);
  });

  it("defaults to the global fetch when no fetchFn is injected", () => {
    expect(() => new GoldPriceDevProvider()).not.toThrow();
  });
});
