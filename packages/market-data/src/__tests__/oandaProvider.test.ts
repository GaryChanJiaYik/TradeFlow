import { describe, expect, it, vi } from "vitest";
import { OANDAProvider, OANDAProviderError } from "../oandaProvider.js";

function makeConfig(fetchFn: typeof fetch) {
  return {
    apiToken: "fake-test-token",
    accountId: "fake-account-id",
    environment: "practice" as const,
    fetchFn,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

describe("OANDAProvider", () => {
  it("parses a successful response into a midpoint PriceUpdate", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        prices: [
          {
            instrument: "XAU_USD",
            closeoutBid: "2400.10",
            closeoutAsk: "2400.50",
          },
        ],
      }),
    );

    const provider = new OANDAProvider(makeConfig(fetchFn));
    const result = await provider.getPrice("XAUUSD");

    expect(result.instrument).toBe("XAUUSD");
    expect(result.provider).toBe("OANDA");
    expect(result.price).toBeCloseTo(2400.3, 5);
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api-fxpractice.oanda.com/v3/accounts/fake-account-id/pricing?instruments=XAU_USD",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer fake-test-token",
    );
  });

  it("throws OANDAProviderError on an HTTP error status", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, { errorMessage: "Unauthorized" }));
    const provider = new OANDAProvider(makeConfig(fetchFn));

    await expect(provider.getPrice("XAUUSD")).rejects.toMatchObject({
      code: "HTTP_ERROR",
    });
    await expect(provider.getPrice("XAUUSD")).rejects.toBeInstanceOf(OANDAProviderError);
  });

  it("throws OANDAProviderError (never NaN) on an empty prices array", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { prices: [] }));
    const provider = new OANDAProvider(makeConfig(fetchFn));

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OANDAProviderError);
    expect((error as OANDAProviderError).code).toBe("EMPTY_PRICES");
  });

  it("throws OANDAProviderError (never NaN) on a malformed price entry", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        prices: [{ instrument: "XAU_USD", closeoutBid: "not-a-number", closeoutAsk: "2400.50" }],
      }),
    );
    const provider = new OANDAProvider(makeConfig(fetchFn));

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OANDAProviderError);
    expect((error as OANDAProviderError).code).toBe("INVALID_PRICE");
  });

  it("throws OANDAProviderError on a missing prices field entirely", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const provider = new OANDAProvider(makeConfig(fetchFn));

    const error = await provider.getPrice("XAUUSD").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OANDAProviderError);
    expect((error as OANDAProviderError).code).toBe("EMPTY_PRICES");
  });

  it("throws OANDAProviderError for an instrument with no OANDA mapping", async () => {
    const fetchFn = vi.fn();
    const provider = new OANDAProvider(makeConfig(fetchFn));

    const error = await provider.getPrice("UNKNOWN_SYMBOL").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OANDAProviderError);
    expect((error as OANDAProviderError).code).toBe("UNKNOWN_INSTRUMENT");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
