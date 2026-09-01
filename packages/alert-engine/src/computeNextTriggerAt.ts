/**
 * Computes the next occurrence of a `graph_reminders` timeframe boundary,
 * in the reminder's own IANA timezone, strictly after `from`.
 *
 * Interpretation (not spelled out to the boundary-alignment level of detail
 * in handoff/ARCHITECT-BRIEF.md or PROJECT_SPEC.txt's Feature B — flagged as
 * a Builder decision, same category as Step 1's `handle_new_user` trigger):
 * a reminder's timeframe is meant to mirror a chart candle's timeframe, so
 * "due every 15m/1H/4H/1D" means aligned to that timeframe's natural clock
 * boundary in the user's timezone (15m -> :00/:15/:30/:45, 1H -> top of the
 * hour, 4H -> 00/04/08/12/16/20, 1D -> local midnight) — matching when a
 * chart candle of that timeframe closes — rather than "N minutes from
 * whenever the reminder was created."
 *
 * Shared by both the web app (server actions, computing the initial/updated
 * `next_trigger_at` at write time) and the `tick` Edge Function (recomputing
 * it after each fire) — see handoff/ARCHITECT-BRIEF.md Step 3 Decisions for
 * why this moved here from supabase/functions/tick/nextTrigger.ts (Deno-only
 * originally): one implementation, imported by both environments via
 * relative path, same pattern already used for `evaluatePriceAlert`.
 */

import type { ReminderTimeframe } from "@tradeflow/types";

const TIMEFRAME_MINUTES: Record<Exclude<ReminderTimeframe, "1D">, number> = {
  "15m": 15,
  "1H": 60,
  "4H": 240,
};

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getWallClock(instant: Date, timeZone: string): WallClock {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Missing "${type}" in formatted date parts.`);
    // Intl can format the midnight hour as "24"; normalize to 0.
    const value = Number(part.value);
    return type === "hour" && value === 24 ? 0 : value;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * Converts a wall-clock time expressed *in* `timeZone` back to the UTC
 * instant it represents, via a fixed-point correction (the standard
 * technique used by timezone libraries like date-fns-tz's zonedTimeToUtc):
 * guess the instant assuming the wall clock was UTC, measure how far that
 * guess's formatted wall clock in `timeZone` is from the target, and
 * correct. Two iterations comfortably converge for real IANA zones (at most
 * one DST shift of a few hours).
 */
function zonedWallClockToUtc(wall: WallClock, timeZone: string): Date {
  let guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);

  for (let i = 0; i < 2; i++) {
    const guessWall = getWallClock(new Date(guess), timeZone);
    const guessAsUtc = Date.UTC(
      guessWall.year,
      guessWall.month - 1,
      guessWall.day,
      guessWall.hour,
      guessWall.minute,
      guessWall.second,
    );
    const targetAsUtc = Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
    const diff = targetAsUtc - guessAsUtc;
    if (diff === 0) break;
    guess += diff;
  }

  return new Date(guess);
}

/**
 * Minutes-since-midnight window, both ends 0-1439. `startMinutes ===
 * endMinutes` (the "no restriction" case) must never reach this function —
 * that normalization happens in the caller (see
 * packages/validation/src/graphReminder.ts's equal-times-collapse-to-null
 * transform); this function assumes a `window`, when passed, always has a
 * nonzero length.
 */
export interface ReminderWindow {
  startMinutes: number;
  endMinutes: number;
}

/**
 * Computes minutes strictly after `wallMinutesOfDay` (a wall-clock
 * minutes-since-midnight value, 0-1439) until the next occurrence, given an
 * optional market-open/close window.
 *
 * `offset` = minutes elapsed since the most recent window-start occurrence
 * (whether that instance began today or — for a window that wraps past
 * midnight — yesterday). `1440 - offset` is the distance forward to the
 * *next* window-start occurrence (exactly one day after the most recent
 * one, since a window recurs once every 24h) — used both when we've just
 * rolled off the last in-window slot and when we're currently outside any
 * window instance; both are "wait for the next window to open."
 *
 * See handoff/ARCHITECT-BRIEF.md Step 5 Builder Plan for why this formula
 * (rather than the brief's initially-suggested rollover expression) is what
 * actually reproduces the brief's own worked examples — verified by hand
 * against all three before writing the tests.
 */
function minutesToNextPeriodicOccurrence(
  wallMinutesOfDay: number,
  stepMinutes: number,
  window: ReminderWindow,
): number {
  const windowLength = ((window.endMinutes - window.startMinutes) + 1440) % 1440;
  const offset = (((wallMinutesOfDay - window.startMinutes) % 1440) + 1440) % 1440;

  if (offset < windowLength) {
    const currentSlot = Math.floor(offset / stepMinutes);
    const nextSlotOffset = (currentSlot + 1) * stepMinutes;
    if (nextSlotOffset < windowLength) {
      return nextSlotOffset - offset;
    }
    // Rolled off the last slot inside this window instance — wait for the
    // next window instance to open.
    return 1440 - offset;
  }

  // Currently outside any window instance — wait for the next one to open.
  return 1440 - offset;
}

/**
 * Computes minutes strictly after `wallMinutesOfDay` until the single daily
 * occurrence anchored at `window.startMinutes`. Generalizes the existing
 * midnight-anchored 1D behavior (which is the `startMinutes = 0` case of
 * this same formula) rather than unconditionally "always add a day," which
 * would incorrectly skip *today's* still-upcoming anchor occurrence
 * whenever `startMinutes` is later in the day than the current wall clock.
 */
function minutesToNextDailyOccurrence(wallMinutesOfDay: number, startMinutes: number): number {
  const offset = (((wallMinutesOfDay - startMinutes) % 1440) + 1440) % 1440;
  return 1440 - offset;
}

export function computeNextTriggerAt(
  timeframe: ReminderTimeframe,
  timezone: string,
  from: Date,
  window?: ReminderWindow,
): Date {
  const wall = getWallClock(from, timezone);

  let nextWall: WallClock;

  if (window) {
    const totalMinutesToday = wall.hour * 60 + wall.minute;
    const minutesToNext =
      timeframe === "1D"
        ? minutesToNextDailyOccurrence(totalMinutesToday, window.startMinutes)
        : minutesToNextPeriodicOccurrence(totalMinutesToday, TIMEFRAME_MINUTES[timeframe], window);

    // Same "offset from today's midnight, let Date.UTC-style ms arithmetic
    // roll over calendar days" trick the non-window branches below use.
    const dayStartUtcMs = Date.UTC(wall.year, wall.month - 1, wall.day, 0, 0, 0);
    const nextUtcMs = dayStartUtcMs + (totalMinutesToday + minutesToNext) * 60 * 1000;
    const next = new Date(nextUtcMs);
    nextWall = {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour: next.getUTCHours(),
      minute: next.getUTCMinutes(),
      second: 0,
    };
    return zonedWallClockToUtc(nextWall, timezone);
  }

  if (timeframe === "1D") {
    // Floor to local midnight, then add one day.
    const flooredUtcMs = Date.UTC(wall.year, wall.month - 1, wall.day, 0, 0, 0);
    const nextUtcMs = flooredUtcMs + 24 * 60 * 60 * 1000;
    const next = new Date(nextUtcMs);
    nextWall = {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    };
  } else {
    const stepMinutes = TIMEFRAME_MINUTES[timeframe];
    const totalMinutesToday = wall.hour * 60 + wall.minute;
    const flooredMinutes = Math.floor(totalMinutesToday / stepMinutes) * stepMinutes;
    const nextMinutesFromDayStart = flooredMinutes + stepMinutes;

    // Express as an offset from local midnight, then let Date.UTC's
    // overflow handling roll it into the correct next calendar day when
    // nextMinutesFromDayStart >= 1440 (e.g. 23:45 + 15m for "15m").
    const dayStartUtcMs = Date.UTC(wall.year, wall.month - 1, wall.day, 0, 0, 0);
    const nextUtcMs = dayStartUtcMs + nextMinutesFromDayStart * 60 * 1000;
    const next = new Date(nextUtcMs);
    nextWall = {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour: next.getUTCHours(),
      minute: next.getUTCMinutes(),
      second: 0,
    };
  }

  return zonedWallClockToUtc(nextWall, timezone);
}
