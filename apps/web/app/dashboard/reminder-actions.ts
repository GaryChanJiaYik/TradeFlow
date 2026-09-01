"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createGraphReminderSchema, updateGraphReminderSchema } from "@tradeflow/validation";
import { computeNextTriggerAt } from "@tradeflow/alert-engine";
import type { GraphReminder } from "@tradeflow/types";
import { createClient } from "@/lib/supabase/server";

export type ReminderFormState = {
  error?: string;
};

const XAUUSD_SYMBOL = "XAUUSD";

/**
 * Step 3 still has exactly one tradable instrument and the UI never lets a
 * user pick a different one (same as price alerts) — resolve it by symbol
 * rather than taking it as form input. Deliberately not shared with
 * actions.ts's identical helper: the two action files are already
 * independent today (see actions.ts / device-actions.ts) and the brief asks
 * to mirror the pattern, not extract a util.
 */
async function getXauUsdInstrumentId(
  supabase: ReturnType<typeof createClient>,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from("instruments")
    .select("id")
    .eq("symbol", XAUUSD_SYMBOL)
    .maybeSingle();

  if (error || !data) {
    return { error: "XAUUSD instrument is not configured." };
  }
  return { id: data.id as string };
}

/**
 * An empty `<input type="time">` submits `""`, not an absent field —
 * normalize that to `null` before it reaches the zod schema (same pattern
 * `description` already uses below), so "left blank" reads as "no window,"
 * not as a malformed `"HH:MM"` string.
 */
function readOptionalTimeField(formData: FormData, name: string): string | null {
  const raw = formData.get(name);
  return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

function readReminderFormFields(formData: FormData) {
  const descriptionRaw = formData.get("description");
  return {
    timeframe: formData.get("timeframe"),
    description:
      typeof descriptionRaw === "string" && descriptionRaw.trim() !== "" ? descriptionRaw : null,
    timezone: formData.get("timezone"),
    enabled: formData.get("enabled") === "on",
    window_start_time: readOptionalTimeField(formData, "window_start_time"),
    window_end_time: readOptionalTimeField(formData, "window_end_time"),
  };
}

/**
 * `"HH:MM"` -> minutes-since-midnight, for `computeNextTriggerAt`'s `window`
 * argument — that function stays a pure numbers-in function (see
 * handoff/ARCHITECT-BRIEF.md Step 5 Flags); the "HH:MM" string parsing
 * belongs here, in the caller.
 */
function timeStringToMinutes(value: string): number {
  const [hourStr, minuteStr] = value.split(":");
  return Number(hourStr) * 60 + Number(minuteStr);
}

function buildWindowArg(
  windowStartTime: string | null | undefined,
  windowEndTime: string | null | undefined,
): { startMinutes: number; endMinutes: number } | undefined {
  if (!windowStartTime || !windowEndTime) return undefined;
  return {
    startMinutes: timeStringToMinutes(windowStartTime),
    endMinutes: timeStringToMinutes(windowEndTime),
  };
}

/**
 * DB `time` columns round-trip as `"HH:MM:SS"`; validated form input is
 * `"HH:MM"`. Normalize both to `"HH:MM"` before comparing, so an edit that
 * doesn't actually touch the window doesn't spuriously look like a change
 * (and trigger an unnecessary `next_trigger_at` recompute) just because of
 * the seconds component.
 */
function normalizeTimeForCompare(value: string | null | undefined): string | null {
  return value ? value.slice(0, 5) : null;
}

export async function createReminderAction(
  _prevState: ReminderFormState,
  formData: FormData,
): Promise<ReminderFormState> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = createGraphReminderSchema.safeParse(readReminderFormFields(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const instrument = await getXauUsdInstrumentId(supabase);
  if ("error" in instrument) return { error: instrument.error };

  const now = new Date();
  const window = buildWindowArg(parsed.data.window_start_time, parsed.data.window_end_time);
  const nextTriggerAt = computeNextTriggerAt(parsed.data.timeframe, parsed.data.timezone, now, window);

  const { error } = await supabase.from("graph_reminders").insert({
    user_id: user.id,
    instrument_id: instrument.id,
    next_trigger_at: nextTriggerAt.toISOString(),
    ...parsed.data,
  });

  if (error) {
    return { error: "Could not create reminder. Please try again." };
  }

  revalidatePath("/dashboard/reminders");
  redirect("/dashboard/reminders");
}

export async function updateReminderAction(
  reminderId: string,
  _prevState: ReminderFormState,
  formData: FormData,
): Promise<ReminderFormState> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = updateGraphReminderSchema.safeParse(readReminderFormFields(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { data: existing, error: fetchError } = await supabase
    .from("graph_reminders")
    .select("timeframe, timezone, window_start_time, window_end_time")
    .eq("id", reminderId)
    .eq("user_id", user.id)
    .maybeSingle<
      Pick<GraphReminder, "timeframe" | "timezone" | "window_start_time" | "window_end_time">
    >();

  if (fetchError || !existing) {
    return { error: "Reminder not found." };
  }

  // Recompute next_trigger_at only when timeframe, timezone, or the window
  // actually changed — an edit that only touches description/enabled
  // shouldn't reset the reminder's schedule.
  const scheduleChanged =
    existing.timeframe !== parsed.data.timeframe ||
    existing.timezone !== parsed.data.timezone ||
    normalizeTimeForCompare(existing.window_start_time) !== (parsed.data.window_start_time ?? null) ||
    normalizeTimeForCompare(existing.window_end_time) !== (parsed.data.window_end_time ?? null);

  const update: Record<string, unknown> = { ...parsed.data };
  if (scheduleChanged) {
    const window = buildWindowArg(parsed.data.window_start_time, parsed.data.window_end_time);
    const nextTriggerAt = computeNextTriggerAt(
      parsed.data.timeframe,
      parsed.data.timezone,
      new Date(),
      window,
    );
    update.next_trigger_at = nextTriggerAt.toISOString();
  }

  const { error } = await supabase
    .from("graph_reminders")
    .update(update)
    .eq("id", reminderId)
    .eq("user_id", user.id);

  if (error) {
    return { error: "Could not update reminder. Please try again." };
  }

  revalidatePath("/dashboard/reminders");
  redirect("/dashboard/reminders");
}

export async function setReminderEnabledAction(formData: FormData): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const reminderId = formData.get("reminderId");
  const nextEnabled = formData.get("nextEnabled") === "true";
  if (typeof reminderId !== "string") return;

  await supabase
    .from("graph_reminders")
    .update({ enabled: nextEnabled })
    .eq("id", reminderId)
    .eq("user_id", user.id);

  revalidatePath("/dashboard/reminders");
}

export async function deleteReminderAction(formData: FormData): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const reminderId = formData.get("reminderId");
  if (typeof reminderId !== "string") return;

  await supabase.from("graph_reminders").delete().eq("id", reminderId).eq("user_id", user.id);

  revalidatePath("/dashboard/reminders");
}
