import { describe, expect, it } from "vitest";
import { applyPriceBasis, computePriceBasis } from "../priceBasis.js";

describe("computePriceBasis", () => {
  it("computes a positive basis when the reference trades above raw", () => {
    const result = computePriceBasis(4350, 4340);
    expect(result.rejected).toBe(false);
    if (!result.rejected) {
      expect(result.basis).toBeCloseTo(10, 5);
      expect(result.deltaPct).toBeCloseTo((10 / 4340) * 100, 5);
    }
  });

  it("computes a negative basis when the reference trades below raw", () => {
    const result = computePriceBasis(4330, 4340);
    expect(result.rejected).toBe(false);
    if (!result.rejected) {
      expect(result.basis).toBeCloseTo(-10, 5);
    }
  });

  it("computes a zero basis when reference equals raw", () => {
    const result = computePriceBasis(4340, 4340);
    expect(result.rejected).toBe(false);
    if (!result.rejected) {
      expect(result.basis).toBe(0);
    }
  });

  it("accepts a basis right at the sanity bound", () => {
    const rawPrice = 4340;
    const referencePrice = rawPrice * 1.05;
    const result = computePriceBasis(referencePrice, rawPrice);
    expect(result.rejected).toBe(false);
  });

  it("rejects a basis beyond the sanity bound", () => {
    const rawPrice = 4340;
    const referencePrice = rawPrice * 1.10;
    const result = computePriceBasis(referencePrice, rawPrice);
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reason).toMatch(/exceeds the 5% sanity bound/);
    }
  });

  it("rejects a large negative outlier the same as a large positive one", () => {
    const rawPrice = 4340;
    const referencePrice = rawPrice * 0.9;
    const result = computePriceBasis(referencePrice, rawPrice);
    expect(result.rejected).toBe(true);
  });
});

describe("applyPriceBasis", () => {
  it("returns the raw price unchanged when basis is null", () => {
    expect(applyPriceBasis(4340, null)).toBe(4340);
  });

  it("adds a positive basis to the raw price", () => {
    expect(applyPriceBasis(4340, 10)).toBe(4350);
  });

  it("adds a negative basis to the raw price", () => {
    expect(applyPriceBasis(4340, -10)).toBe(4330);
  });
});
