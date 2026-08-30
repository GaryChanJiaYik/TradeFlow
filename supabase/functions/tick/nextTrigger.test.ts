// Run with: deno test supabase/functions/tick/nextTrigger.test.ts
// No external test-framework import (kept dependency-free) — plain
// Deno.test + manual assertions.
import { computeNextTriggerAt } from "./nextTrigger.ts";

function assertIso(actual: Date, expectedIso: string, label: string) {
  const actualIso = actual.toISOString();
  if (actualIso !== expectedIso) {
    throw new Error(`${label}: expected ${expectedIso}, got ${actualIso}`);
  }
}

Deno.test("15m in UTC floors-then-advances to the next quarter hour", () => {
  const from = new Date("2026-08-30T12:07:00.000Z");
  const next = computeNextTriggerAt("15m", "UTC", from);
  assertIso(next, "2026-08-30T12:15:00.000Z", "15m UTC mid-quarter");
});

Deno.test("15m in UTC exactly on a boundary advances a full step", () => {
  const from = new Date("2026-08-30T12:15:00.000Z");
  const next = computeNextTriggerAt("15m", "UTC", from);
  assertIso(next, "2026-08-30T12:30:00.000Z", "15m UTC on-boundary");
});

Deno.test("1H in UTC advances to the top of the next hour", () => {
  const from = new Date("2026-08-30T12:59:00.000Z");
  const next = computeNextTriggerAt("1H", "UTC", from);
  assertIso(next, "2026-08-30T13:00:00.000Z", "1H UTC");
});

Deno.test("4H in UTC rolls into the next calendar day correctly", () => {
  const from = new Date("2026-08-30T23:10:00.000Z");
  const next = computeNextTriggerAt("4H", "UTC", from);
  assertIso(next, "2026-08-31T00:00:00.000Z", "4H UTC day rollover");
});

Deno.test("1D in UTC advances to the next local midnight", () => {
  const from = new Date("2026-08-30T05:00:00.000Z");
  const next = computeNextTriggerAt("1D", "UTC", from);
  assertIso(next, "2026-08-31T00:00:00.000Z", "1D UTC");
});

Deno.test("1D in a fixed +8 timezone (Asia/Kuala_Lumpur) converts to correct UTC instant", () => {
  // 2026-08-30 20:00 in UTC+8 is still 2026-08-30 local — next midnight is
  // 2026-08-31 00:00 +08:00 == 2026-08-30T16:00:00Z.
  const from = new Date("2026-08-30T12:00:00.000Z"); // 20:00 local (+8)
  const next = computeNextTriggerAt("1D", "Asia/Kuala_Lumpur", from);
  assertIso(next, "2026-08-30T16:00:00.000Z", "1D Asia/Kuala_Lumpur");
});

Deno.test("4H in a fixed +8 timezone aligns to local 4H boundaries, not UTC ones", () => {
  // 09:30 local (+8) == 01:30Z. Next local 4H boundary is 12:00 local == 04:00Z.
  const from = new Date("2026-08-30T01:30:00.000Z");
  const next = computeNextTriggerAt("4H", "Asia/Kuala_Lumpur", from);
  assertIso(next, "2026-08-30T04:00:00.000Z", "4H Asia/Kuala_Lumpur");
});

Deno.test("1H across a US DST fall-back transition still lands on the correct UTC instant", () => {
  // US DST ends 2026-11-01 02:00 local (America/New_York) clocks fall back
  // to 01:00. 2026-11-01T05:30:00Z is 01:30 EDT (UTC-4, pre-fallback).
  // Next top-of-hour local is 02:00 EST (UTC-5) == 2026-11-01T07:00:00Z.
  const from = new Date("2026-11-01T05:30:00.000Z");
  const next = computeNextTriggerAt("1H", "America/New_York", from);
  assertIso(next, "2026-11-01T07:00:00.000Z", "1H DST fall-back");
});

Deno.test("computeNextTriggerAt always returns a strictly future instant", () => {
  const from = new Date();
  for (const tf of ["15m", "1H", "4H", "1D"] as const) {
    const next = computeNextTriggerAt(tf, "UTC", from);
    if (next.getTime() <= from.getTime()) {
      throw new Error(`${tf}: expected a future instant, got ${next.toISOString()}`);
    }
  }
});
