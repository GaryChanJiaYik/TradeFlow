import { describe, expect, it } from "vitest";
import { createGraphReminderSchema, updateGraphReminderSchema } from "../graphReminder";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    timeframe: "1H",
    description: "Check the trendline",
    timezone: "Asia/Kuala_Lumpur",
    enabled: true,
    ...overrides,
  };
}

describe("createGraphReminderSchema", () => {
  it.each(["15m", "1H", "4H", "1D"])("accepts a valid timeframe: %s", (timeframe) => {
    const result = createGraphReminderSchema.safeParse(baseInput({ timeframe }));
    expect(result.success).toBe(true);
  });

  it("rejects an invalid timeframe", () => {
    const result = createGraphReminderSchema.safeParse(baseInput({ timeframe: "5m" }));
    expect(result.success).toBe(false);
  });

  it.each(["UTC", "Asia/Kuala_Lumpur", "America/New_York", "Europe/London"])(
    "accepts a valid IANA timezone: %s",
    (timezone) => {
      const result = createGraphReminderSchema.safeParse(baseInput({ timezone }));
      expect(result.success).toBe(true);
    },
  );

  it("rejects a bogus timezone string", () => {
    const result = createGraphReminderSchema.safeParse(baseInput({ timezone: "Not/A_Zone" }));
    expect(result.success).toBe(false);
  });

  it("rejects an arbitrary string masquerading as a timezone (e.g. a fixed offset)", () => {
    const result = createGraphReminderSchema.safeParse(baseInput({ timezone: "GMT+8" }));
    expect(result.success).toBe(false);
  });

  it("accepts a missing description", () => {
    const { description, ...rest } = baseInput();
    const result = createGraphReminderSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("accepts a null description", () => {
    const result = createGraphReminderSchema.safeParse(baseInput({ description: null }));
    expect(result.success).toBe(true);
  });

  it("accepts an empty-string description", () => {
    const result = createGraphReminderSchema.safeParse(baseInput({ description: "" }));
    expect(result.success).toBe(true);
  });

  it("rejects a description over 500 chars", () => {
    const result = createGraphReminderSchema.safeParse(
      baseInput({ description: "a".repeat(501) }),
    );
    expect(result.success).toBe(false);
  });

  it("defaults enabled to true when omitted", () => {
    const { enabled, ...rest } = baseInput();
    const result = createGraphReminderSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.enabled).toBe(true);
  });
});

describe("updateGraphReminderSchema", () => {
  it("requires enabled to be explicitly provided (no default)", () => {
    const { enabled, ...rest } = baseInput();
    const result = updateGraphReminderSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("accepts a full valid update payload", () => {
    const result = updateGraphReminderSchema.safeParse(baseInput({ timeframe: "4H", enabled: false }));
    expect(result.success).toBe(true);
  });
});
