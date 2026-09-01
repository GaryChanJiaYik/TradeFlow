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

describe("market-open/close window fields (Step 5)", () => {
  it("accepts both fields omitted, normalizing to explicit null/null", () => {
    const result = createGraphReminderSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.window_start_time).toBeNull();
      expect(result.data.window_end_time).toBeNull();
    }
  });

  it("accepts both fields explicitly null", () => {
    const result = createGraphReminderSchema.safeParse(
      baseInput({ window_start_time: null, window_end_time: null }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts both fields set to valid, distinct HH:MM times", () => {
    const result = createGraphReminderSchema.safeParse(
      baseInput({ window_start_time: "06:00", window_end_time: "22:00" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.window_start_time).toBe("06:00");
      expect(result.data.window_end_time).toBe("22:00");
    }
  });

  it("accepts an overnight-wrapping window (start later than end)", () => {
    const result = createGraphReminderSchema.safeParse(
      baseInput({ window_start_time: "22:00", window_end_time: "06:00" }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects window_start_time set without window_end_time", () => {
    const result = createGraphReminderSchema.safeParse(baseInput({ window_start_time: "06:00" }));
    expect(result.success).toBe(false);
  });

  it("rejects window_end_time set without window_start_time", () => {
    const result = createGraphReminderSchema.safeParse(baseInput({ window_end_time: "22:00" }));
    expect(result.success).toBe(false);
  });

  it("rejects a malformed time string", () => {
    const result = createGraphReminderSchema.safeParse(
      baseInput({ window_start_time: "6:00", window_end_time: "22:00" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range time string", () => {
    const result = createGraphReminderSchema.safeParse(
      baseInput({ window_start_time: "25:00", window_end_time: "22:00" }),
    );
    expect(result.success).toBe(false);
  });

  it("normalizes equal start/end times to null/null — 'no restriction', per the owner's own framing", () => {
    const result = createGraphReminderSchema.safeParse(
      baseInput({ window_start_time: "06:00", window_end_time: "06:00" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.window_start_time).toBeNull();
      expect(result.data.window_end_time).toBeNull();
    }
  });

  it("updateGraphReminderSchema enforces the same both-or-neither rule", () => {
    const result = updateGraphReminderSchema.safeParse(
      baseInput({ enabled: true, window_start_time: "06:00" }),
    );
    expect(result.success).toBe(false);
  });
});
