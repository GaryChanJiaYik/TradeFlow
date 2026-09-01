import { describe, expect, it } from "vitest";
import { computeNextTriggerAt } from "../computeNextTriggerAt.js";

function assertIso(actual: Date, expectedIso: string) {
  expect(actual.toISOString()).toBe(expectedIso);
}

describe("computeNextTriggerAt", () => {
  it("15m in UTC floors-then-advances to the next quarter hour", () => {
    const from = new Date("2026-08-30T12:07:00.000Z");
    const next = computeNextTriggerAt("15m", "UTC", from);
    assertIso(next, "2026-08-30T12:15:00.000Z");
  });

  it("15m in UTC exactly on a boundary advances a full step", () => {
    const from = new Date("2026-08-30T12:15:00.000Z");
    const next = computeNextTriggerAt("15m", "UTC", from);
    assertIso(next, "2026-08-30T12:30:00.000Z");
  });

  it("1H in UTC advances to the top of the next hour", () => {
    const from = new Date("2026-08-30T12:59:00.000Z");
    const next = computeNextTriggerAt("1H", "UTC", from);
    assertIso(next, "2026-08-30T13:00:00.000Z");
  });

  it("4H in UTC rolls into the next calendar day correctly", () => {
    const from = new Date("2026-08-30T23:10:00.000Z");
    const next = computeNextTriggerAt("4H", "UTC", from);
    assertIso(next, "2026-08-31T00:00:00.000Z");
  });

  it("1D in UTC advances to the next local midnight", () => {
    const from = new Date("2026-08-30T05:00:00.000Z");
    const next = computeNextTriggerAt("1D", "UTC", from);
    assertIso(next, "2026-08-31T00:00:00.000Z");
  });

  it("1D in a fixed +8 timezone (Asia/Kuala_Lumpur) converts to correct UTC instant", () => {
    // 2026-08-30 20:00 in UTC+8 is still 2026-08-30 local — next midnight is
    // 2026-08-31 00:00 +08:00 == 2026-08-30T16:00:00Z.
    const from = new Date("2026-08-30T12:00:00.000Z"); // 20:00 local (+8)
    const next = computeNextTriggerAt("1D", "Asia/Kuala_Lumpur", from);
    assertIso(next, "2026-08-30T16:00:00.000Z");
  });

  it("4H in a fixed +8 timezone aligns to local 4H boundaries, not UTC ones", () => {
    // 09:30 local (+8) == 01:30Z. Next local 4H boundary is 12:00 local == 04:00Z.
    const from = new Date("2026-08-30T01:30:00.000Z");
    const next = computeNextTriggerAt("4H", "Asia/Kuala_Lumpur", from);
    assertIso(next, "2026-08-30T04:00:00.000Z");
  });

  it("1H across a US DST fall-back transition still lands on the correct UTC instant", () => {
    // US DST ends 2026-11-01 02:00 local (America/New_York) clocks fall back
    // to 01:00. 2026-11-01T05:30:00Z is 01:30 EDT (UTC-4, pre-fallback).
    // Next top-of-hour local is 02:00 EST (UTC-5) == 2026-11-01T07:00:00Z.
    const from = new Date("2026-11-01T05:30:00.000Z");
    const next = computeNextTriggerAt("1H", "America/New_York", from);
    assertIso(next, "2026-11-01T07:00:00.000Z");
  });

  it("always returns a strictly future instant", () => {
    const from = new Date();
    for (const tf of ["15m", "1H", "4H", "1D"] as const) {
      const next = computeNextTriggerAt(tf, "UTC", from);
      expect(next.getTime()).toBeGreaterThan(from.getTime());
    }
  });

  it("passing `undefined` explicitly as the window arg is a no-op, same as omitting it", () => {
    const from = new Date("2026-08-30T12:07:00.000Z");
    const next = computeNextTriggerAt("15m", "UTC", from, undefined);
    assertIso(next, "2026-08-30T12:15:00.000Z");
  });
});

describe("computeNextTriggerAt — market-open/close window (Step 5)", () => {
  // Worked example 1 (brief): window 06:00-22:00 (windowLength = 960), 4H
  // (step = 240) -> slots at 06:00, 10:00, 14:00, 18:00; 22:00 excluded.
  const window0622 = { startMinutes: 360, endMinutes: 1320 };

  it("4H, from=09:00 inside the window: next is 10:00 TODAY, not 13:00 (9am+4h) — the exact owner-reported case", () => {
    const from = new Date("2026-08-30T09:00:00.000Z");
    const next = computeNextTriggerAt("4H", "UTC", from, window0622);
    assertIso(next, "2026-08-30T10:00:00.000Z");
  });

  it("4H, from exactly at the last in-window slot (18:00): next is next-day 06:00, not 22:00", () => {
    const from = new Date("2026-08-30T18:00:00.000Z");
    const next = computeNextTriggerAt("4H", "UTC", from, window0622);
    assertIso(next, "2026-08-31T06:00:00.000Z");
  });

  it("4H, from exactly at 22:00 (the window's own end, correctly excluded as a slot): rolls to next-day 06:00", () => {
    const from = new Date("2026-08-30T22:00:00.000Z");
    const next = computeNextTriggerAt("4H", "UTC", from, window0622);
    assertIso(next, "2026-08-31T06:00:00.000Z");
  });

  it("4H, from well before the window opens (02:00): next is today's 06:00", () => {
    const from = new Date("2026-08-30T02:00:00.000Z");
    const next = computeNextTriggerAt("4H", "UTC", from, window0622);
    assertIso(next, "2026-08-30T06:00:00.000Z");
  });

  // Worked example 2 (brief): overnight window 22:00-06:00 (windowLength =
  // 480), 1H (step = 60) -> slots at 22,23,00,01,02,03,04,05.
  const windowOvernight = { startMinutes: 1320, endMinutes: 360 };

  it("1H, overnight window, from=23:30 (inside, pre-midnight): next is 00:00", () => {
    const from = new Date("2026-08-30T23:30:00.000Z");
    const next = computeNextTriggerAt("1H", "UTC", from, windowOvernight);
    assertIso(next, "2026-08-31T00:00:00.000Z");
  });

  it("1H, overnight window, from=05:30 (inside, wrapped, last slot): rolls to that day's 22:00, not 06:00", () => {
    const from = new Date("2026-08-31T05:30:00.000Z");
    const next = computeNextTriggerAt("1H", "UTC", from, windowOvernight);
    assertIso(next, "2026-08-31T22:00:00.000Z");
  });

  it("1H, overnight window, from=10:00 (outside the window entirely): next is that day's 22:00", () => {
    const from = new Date("2026-08-31T10:00:00.000Z");
    const next = computeNextTriggerAt("1H", "UTC", from, windowOvernight);
    assertIso(next, "2026-08-31T22:00:00.000Z");
  });

  // No-window regression: re-run existing cases, passing no window arg,
  // asserting identical output to the (untouched) pre-Step-5 behavior.
  it("no window (existing reminder, both columns NULL): identical output to before this change", () => {
    const from = new Date("2026-08-30T23:10:00.000Z");
    const next = computeNextTriggerAt("4H", "UTC", from);
    assertIso(next, "2026-08-31T00:00:00.000Z");
  });

  it("no window, 1D case: identical output to before this change", () => {
    const from = new Date("2026-08-30T05:00:00.000Z");
    const next = computeNextTriggerAt("1D", "UTC", from);
    assertIso(next, "2026-08-31T00:00:00.000Z");
  });

  // 1D anchored to a non-midnight window_start_time.
  it("1D with window, anchor still ahead today (from=08:00, anchor=10:00): next is TODAY at 10:00", () => {
    const from = new Date("2026-08-31T08:00:00.000Z");
    const next = computeNextTriggerAt("1D", "UTC", from, { startMinutes: 600, endMinutes: 601 });
    assertIso(next, "2026-08-31T10:00:00.000Z");
  });

  it("1D with window, anchor already passed today (from=12:00, anchor=10:00): next is TOMORROW at 10:00", () => {
    const from = new Date("2026-08-31T12:00:00.000Z");
    const next = computeNextTriggerAt("1D", "UTC", from, { startMinutes: 600, endMinutes: 601 });
    assertIso(next, "2026-09-01T10:00:00.000Z");
  });

  it("1D with window, from exactly at the anchor: next is strictly the FOLLOWING day's anchor, not now", () => {
    const from = new Date("2026-08-31T10:00:00.000Z");
    const next = computeNextTriggerAt("1D", "UTC", from, { startMinutes: 600, endMinutes: 601 });
    assertIso(next, "2026-09-01T10:00:00.000Z");
  });

  it("4H window in a fixed +8 timezone still aligns to local window boundaries, not UTC ones", () => {
    // 09:00 local (+8) == 01:00Z. Window 06:00-22:00 local, 4H step. Next
    // local slot after 09:00 is 10:00 local == 02:00Z.
    const from = new Date("2026-08-30T01:00:00.000Z");
    const next = computeNextTriggerAt("4H", "Asia/Kuala_Lumpur", from, window0622);
    assertIso(next, "2026-08-30T02:00:00.000Z");
  });

  it("1H, overnight window, across a US DST fall-back transition still lands on the correct UTC instant", () => {
    // Mirrors the pre-existing no-window DST test above, but with an
    // overnight 22:00-06:00 America/New_York window applied, to close the
    // coverage gap Richard flagged (window branch never exercised against a
    // DST-observing zone). Same transition, same hand-derivation:
    //
    // US DST ends 2026-11-01 02:00 local (America/New_York); clocks fall
    // back to 01:00. `from` = 2026-11-01T05:00:00Z is 01:00 EDT (UTC-4,
    // pre-fallback local wall clock) — inside the 22:00-06:00 window
    // (offset from 22:00 = 180min, windowLength = 480min).
    //
    // Window arithmetic (pure minutes-of-day, no DST awareness needed here):
    // currentSlot = floor(180/60) = 3, nextSlotOffset = 240 < 480, so
    // minutesToNext = 240 - 180 = 60 -> next wall clock is 02:00 same local
    // calendar day.
    //
    // That wall clock "02:00 Nov 1" is unambiguous: the fall-back instant
    // (2:00 EDT -> 1:00 EST) means only 1:00-1:59 repeats; 02:00 is already
    // EST (UTC-5) -- the exact same target instant as the no-window DST
    // test above: 2026-11-01T07:00:00Z.
    const from = new Date("2026-11-01T05:00:00.000Z");
    const next = computeNextTriggerAt("1H", "America/New_York", from, windowOvernight);
    assertIso(next, "2026-11-01T07:00:00.000Z");
  });
});
