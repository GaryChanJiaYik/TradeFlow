import { describe, expect, it } from "vitest";
import { evaluatePriceAlert, type EvaluableAlert } from "../evaluatePriceAlert.js";

const NOW = new Date("2026-08-30T12:00:00.000Z");
const FUTURE = new Date("2099-01-01T00:00:00.000Z").toISOString();
const PAST = new Date("2020-01-01T00:00:00.000Z").toISOString();

function baseAlert(overrides: Partial<EvaluableAlert> = {}): EvaluableAlert {
  return {
    target_price: 3400,
    direction: "CROSS_UP",
    trigger_mode: "ONCE",
    expiration_at: null,
    enabled: true,
    last_triggered_at: null,
    ...overrides,
  };
}

describe("evaluatePriceAlert", () => {
  it("CROSS_UP triggers: prev 3399 → cur 3401, target 3400", () => {
    const alert = baseAlert({ direction: "CROSS_UP" });
    expect(evaluatePriceAlert(alert, 3399, 3401, NOW)).toBe(true);
  });

  it("CROSS_UP does NOT trigger without crossing: prev 3401 → cur 3402, target 3400", () => {
    const alert = baseAlert({ direction: "CROSS_UP" });
    expect(evaluatePriceAlert(alert, 3401, 3402, NOW)).toBe(false);
  });

  it("CROSS_DOWN triggers: prev 3401 → cur 3399, target 3400", () => {
    const alert = baseAlert({ direction: "CROSS_DOWN" });
    expect(evaluatePriceAlert(alert, 3401, 3399, NOW)).toBe(true);
  });

  it("CROSS_DOWN does NOT trigger without crossing: prev 3399 → cur 3398, target 3400", () => {
    const alert = baseAlert({ direction: "CROSS_DOWN" });
    expect(evaluatePriceAlert(alert, 3399, 3398, NOW)).toBe(false);
  });

  it("ONCE: fires on first crossing, not on second", () => {
    const alert = baseAlert({ direction: "CROSS_UP", trigger_mode: "ONCE" });

    // First crossing: previously null last_triggered_at -> fires.
    const firstResult = evaluatePriceAlert(alert, 3399, 3401, NOW);
    expect(firstResult).toBe(true);

    // Caller persists last_triggered_at after the first trigger. A second,
    // independent crossing (price dips back below target, then crosses up
    // again) must NOT fire again because trigger_mode is ONCE.
    const alertAfterFirstTrigger = baseAlert({
      direction: "CROSS_UP",
      trigger_mode: "ONCE",
      last_triggered_at: NOW.toISOString(),
    });
    const secondResult = evaluatePriceAlert(alertAfterFirstTrigger, 3399, 3401, NOW);
    expect(secondResult).toBe(false);
  });

  it("EVERY_TIME: fires on first AND a second independent crossing", () => {
    const alert = baseAlert({ direction: "CROSS_UP", trigger_mode: "EVERY_TIME" });

    const firstResult = evaluatePriceAlert(alert, 3399, 3401, NOW);
    expect(firstResult).toBe(true);

    // Caller persists last_triggered_at after the first trigger, but
    // EVERY_TIME must still fire again on a genuine new crossing.
    const alertAfterFirstTrigger = baseAlert({
      direction: "CROSS_UP",
      trigger_mode: "EVERY_TIME",
      last_triggered_at: NOW.toISOString(),
    });
    const secondResult = evaluatePriceAlert(alertAfterFirstTrigger, 3399, 3401, NOW);
    expect(secondResult).toBe(true);
  });

  it("Expired alert: never triggers", () => {
    const alert = baseAlert({ direction: "CROSS_UP", expiration_at: PAST });
    expect(evaluatePriceAlert(alert, 3399, 3401, NOW)).toBe(false);
  });

  it("Disabled alert: never triggers", () => {
    const alert = baseAlert({ direction: "CROSS_UP", enabled: false, expiration_at: FUTURE });
    expect(evaluatePriceAlert(alert, 3399, 3401, NOW)).toBe(false);
  });
});
