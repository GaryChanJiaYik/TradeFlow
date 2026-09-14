import { describe, expect, it, vi } from "vitest";
import { GoldApiProvider, GoldApiProviderError } from "../goldApiProvider.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

/** Fixed "now" used across tests; timestamp fixtures are expressed relative to it. */
const NOW = new Date("2026-09-14T12:00:00.000Z");

function freshBody(overrides: { timestamp?: number; price?: unknown } = {}) {
  return {
    price: overrides.price ?? 4351.16,
    timestamp: overrides.timestamp ?? Math.floor(NOW.getTime() / 1000),
  };
}

describe("GoldApiProvider", () => {
  it("parses a successful, fresh response into a PriceUpdate", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, freshBody()));
    const provider = new GoldApiProvider({ apiKey: "test-key", fetchFn, now: () => NOW });

    const result = await provider.getPrice("XAUUSD");

    expect(result.instrument).toBe("XAUUSD");
    expect(result.provider).toBe("GOLDAPI");
    expect(result.price).toBeCloseTo(4351.16, 5);
    expect(result.timestamp).toBe(NOW.toISOString());

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.goldapi.io/api/XAU/USD");
    expect((init.headers as Record<string, string>)["x-access-token"]).toBe("test-key");
  });

  it("throws GoldApiProviderError with UNKNOWN_INSTRUMENT for an unmapped symbol (no fetch made)", async () => {
    const fetchFn = vi.fn();
    const provider = new GoldApiProvider({ apiKey: "test-key", fetchFn, now: () => NOW });

    const error = await provider.getPrice("EURUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldApiProviderError);
    expect((error as GoldApiProviderError).code).toBe("UNKNOWN_INSTRUMENT");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws GoldApiProviderError with NETWORK_ERROR when fetch itself rejects", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const provider = new GoldApiProvider({ apiKey: "test-key", fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldApiProviderError);
    expect((error as GoldApiProviderError).code).toBe("NETWORK_ERROR");
    expect((error as GoldApiProviderError).message).toContain("fetch failed");
  });

  it("throws GoldApiProviderError with NETWORK_ERROR on a non-JSON response body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("<html>not json</html>", { status: 200, statusText: "OK" }));
    const provider = new GoldApiProvider({ apiKey: "test-key", fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldApiProviderError);
    expect((error as GoldApiProviderError).code).toBe("NETWORK_ERROR");
  });

  it("throws GoldApiProviderError on an HTTP error status (e.g. 429 rate limit exceeded)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(429, { error: "Too many requests" }));
    const provider = new GoldApiProvider({ apiKey: "test-key", fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldApiProviderError);
    expect((error as GoldApiProviderError).code).toBe("HTTP_ERROR");
  });

  it("throws GoldApiProviderError (never NaN) on a missing price field", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { timestamp: Math.floor(NOW.getTime() / 1000) }));
    const provider = new GoldApiProvider({ apiKey: "test-key", fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldApiProviderError);
    expect((error as GoldApiProviderError).code).toBe("INVALID_PRICE");
  });

  it("throws GoldApiProviderError (never NaN) on a non-numeric price field", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, freshBody({ price: "not-a-number" })));
    const provider = new GoldApiProvider({ apiKey: "test-key", fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldApiProviderError);
    expect((error as GoldApiProviderError).code).toBe("INVALID_PRICE");
  });

  it("throws GoldApiProviderError with STALE_DATA when timestamp is missing", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { price: 4351.16 }));
    const provider = new GoldApiProvider({ apiKey: "test-key", fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldApiProviderError);
    expect((error as GoldApiProviderError).code).toBe("STALE_DATA");
  });

  it("throws GoldApiProviderError with STALE_DATA when timestamp is more than 30 minutes old", async () => {
    const staleTimestamp = Math.floor((NOW.getTime() - 31 * 60 * 1000) / 1000);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, freshBody({ timestamp: staleTimestamp })));
    const provider = new GoldApiProvider({ apiKey: "test-key", fetchFn, now: () => NOW });

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoldApiProviderError);
    expect((error as GoldApiProviderError).code).toBe("STALE_DATA");
  });

  it("accepts data exactly at the 30-minute-old boundary (not yet stale)", async () => {
    const boundaryTimestamp = Math.floor((NOW.getTime() - 30 * 60 * 1000) / 1000);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, freshBody({ timestamp: boundaryTimestamp })));
    const provider = new GoldApiProvider({ apiKey: "test-key", fetchFn, now: () => NOW });

    const result = await provider.getPrice("XAUUSD");
    expect(result.price).toBeCloseTo(4351.16, 5);
  });

  it("defaults to the global fetch when no fetchFn is injected", () => {
    expect(() => new GoldApiProvider({ apiKey: "test-key" })).not.toThrow();
  });
});
