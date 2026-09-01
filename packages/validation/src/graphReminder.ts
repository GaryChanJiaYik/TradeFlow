import { z } from "zod";
import { reminderTimeframeSchema } from "./enums";

/**
 * Refinement: must be a name `Intl` actually recognizes as an IANA timezone —
 * not just any string. Deliberately not permissive: a typo'd zone would
 * silently compute wrong `next_trigger_at` boundaries forever.
 *
 * "UTC" is special-cased: it's a fully valid `timeZone` value accepted by
 * `Intl.DateTimeFormat` (and it's the `graph_reminders.timezone` column's own
 * DB default — see supabase/migrations/0001_init.sql), but ECMA-402's
 * `Intl.supportedValuesOf("timeZone")` does not enumerate it on this runtime
 * (a known platform quirk, not a bug in this file — the list contains no
 * `Etc/*` entries at all here, so there's no equivalent name it's listed
 * under either; "UTC" is simply absent from the array).
 * Rejecting the brief's literal `.includes(value)` check here would silently
 * break every reminder using the DB's own default timezone, so "UTC" is
 * allowed alongside whatever `Intl.supportedValuesOf` returns rather than
 * only through it. Flagged as a Builder decision — see Builder Plan.
 */
function isValidIanaTimeZone(value: string): boolean {
  return value === "UTC" || Intl.supportedValuesOf("timeZone").includes(value);
}

const timezoneSchema = z.string().refine(isValidIanaTimeZone, {
  message: "timezone must be a valid IANA timezone name",
});

/**
 * Market-open/close window fields (Step 5), sourced from HTML `<input
 * type="time">` elements — `"HH:MM"` strings, no seconds. Optional/nullable
 * on their own; the both-or-neither requirement and the equal-times
 * normalization are enforced at the object level below (they need both
 * fields at once, which a per-field schema can't express).
 */
const windowTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be a valid time (HH:MM)")
  .optional()
  .nullable();

/**
 * Wraps a create/update field shape with the shared window-fields
 * validation: both `window_start_time`/`window_end_time` set or both
 * absent (mirrors the DB CHECK constraint in
 * supabase/migrations/0004_reminder_window.sql — defense in depth, per the
 * brief, not reliance on the DB alone). If both are present and equal,
 * normalizes to `null`/`null` before it reaches the database — per the
 * owner's own framing ("6am to 6am the next day is equivalent to no set"),
 * this collapses what would otherwise be two different representations of
 * "no restriction" into one.
 */
function withWindowFields<Shape extends z.ZodRawShape>(shape: Shape) {
  return z
    .object({
      ...shape,
      window_start_time: windowTimeSchema,
      window_end_time: windowTimeSchema,
    })
    .refine(
      (data) => {
        const startIsNull = (data.window_start_time ?? null) === null;
        const endIsNull = (data.window_end_time ?? null) === null;
        return startIsNull === endIsNull;
      },
      {
        message: "Market open and market close must both be set, or both left empty",
        path: ["window_end_time"],
      },
    )
    .transform((data) => {
      const start = data.window_start_time ?? null;
      const end = data.window_end_time ?? null;
      if (start !== null && end !== null && start === end) {
        return { ...data, window_start_time: null, window_end_time: null };
      }
      return { ...data, window_start_time: start, window_end_time: end };
    });
}

/**
 * `description` mirrors price alert's `message` field: optional free text,
 * capped at 500 chars for consistency (not specified in
 * handoff/ARCHITECT-BRIEF.md — flagged as a Builder default, see Builder
 * Plan). No `trigger_mode`/`direction`/`target_price` — reminders always
 * recur on their timeframe by design (spec section 16), not a per-instance
 * choice.
 */
export const createGraphReminderSchema = withWindowFields({
  timeframe: reminderTimeframeSchema,
  description: z.string().trim().max(500).optional().nullable(),
  timezone: timezoneSchema,
  enabled: z.boolean().default(true),
});

export type CreateGraphReminderInput = z.infer<typeof createGraphReminderSchema>;

/**
 * Same fields as create — a reminder's `timeframe`/`timezone` can both be
 * edited (unlike price alert's `instrument_id`, which is fixed after
 * creation for a different reason: there's only ever been one instrument).
 */
export const updateGraphReminderSchema = withWindowFields({
  timeframe: reminderTimeframeSchema,
  description: z.string().trim().max(500).optional().nullable(),
  timezone: timezoneSchema,
  enabled: z.boolean(),
});

export type UpdateGraphReminderInput = z.infer<typeof updateGraphReminderSchema>;
