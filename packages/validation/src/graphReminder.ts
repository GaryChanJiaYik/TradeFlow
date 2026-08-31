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
 * `description` mirrors price alert's `message` field: optional free text,
 * capped at 500 chars for consistency (not specified in
 * handoff/ARCHITECT-BRIEF.md — flagged as a Builder default, see Builder
 * Plan). No `trigger_mode`/`direction`/`target_price` — reminders always
 * recur on their timeframe by design (spec section 16), not a per-instance
 * choice.
 */
export const createGraphReminderSchema = z.object({
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
export const updateGraphReminderSchema = z.object({
  timeframe: reminderTimeframeSchema,
  description: z.string().trim().max(500).optional().nullable(),
  timezone: timezoneSchema,
  enabled: z.boolean(),
});

export type UpdateGraphReminderInput = z.infer<typeof updateGraphReminderSchema>;
