/**
 * Step 9: calibrates the fast Binance PAXG/USDT price against a slower,
 * more spot-accurate reference (chartgoldprice.com) — see
 * handoff/ARCHITECT-BRIEF.md's Step 9 Decisions. PAXG trades at its own
 * premium/discount to real spot gold ("basis") that drifts over time; this
 * computes that offset periodically (in `tick`, every 2 minutes) so the
 * fast 10-second path (`tick-fast`) can apply it without needing to touch
 * chartgoldprice itself.
 */

/** Reject a computed basis if it implies the reference and raw price have
 * diverged by more than this — treated as a bad/stale reference reading
 * rather than a real basis, so a flaky chartgoldprice response can't swing
 * the live alert price. Typical PAXG-vs-spot basis has stayed within a
 * fraction of a percent in this project's observations; 5% leaves headroom
 * for genuine volatility while still catching a clearly wrong reading
 * (wrong instrument, stale cache, parsing error). */
export const MAX_BASIS_PCT = 5;

export type ComputeBasisResult =
  | { rejected: false; basis: number; deltaPct: number }
  | { rejected: true; reason: string; deltaPct: number };

/**
 * `referencePrice` (chartgoldprice) minus `rawPrice` (raw Binance PAXG) —
 * the offset to add to future raw Binance prices to approximate real spot.
 * Pure, I/O-free: the caller fetches both prices and persists the result.
 */
export function computePriceBasis(referencePrice: number, rawPrice: number): ComputeBasisResult {
  const basis = referencePrice - rawPrice;
  const deltaPct = (basis / rawPrice) * 100;

  if (Math.abs(deltaPct) > MAX_BASIS_PCT) {
    return {
      rejected: true,
      reason: `basis ${basis.toFixed(4)} (${deltaPct.toFixed(4)}%) exceeds the ${MAX_BASIS_PCT}% sanity bound`,
      deltaPct,
    };
  }

  return { rejected: false, basis, deltaPct };
}

/**
 * Applies a previously-computed basis to a fresh raw price. `basis === null`
 * (no successful `tick` calibration yet, or every calibration so far
 * rejected) means "no correction available" — falls back to the raw price
 * unchanged, same as this project's other null-baseline skip branches.
 */
export function applyPriceBasis(rawPrice: number, basis: number | null): number {
  return rawPrice + (basis ?? 0);
}
