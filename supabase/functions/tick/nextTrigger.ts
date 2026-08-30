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
 */

export type ReminderTimeframe = "15m" | "1H" | "4H" | "1D";

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

export function computeNextTriggerAt(
  timeframe: ReminderTimeframe,
  timezone: string,
  from: Date,
): Date {
  const wall = getWallClock(from, timezone);

  let nextWall: WallClock;
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
