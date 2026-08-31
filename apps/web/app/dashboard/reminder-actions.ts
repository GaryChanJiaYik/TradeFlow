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

function readReminderFormFields(formData: FormData) {
  const descriptionRaw = formData.get("description");
  return {
    timeframe: formData.get("timeframe"),
    description:
      typeof descriptionRaw === "string" && descriptionRaw.trim() !== "" ? descriptionRaw : null,
    timezone: formData.get("timezone"),
    enabled: formData.get("enabled") === "on",
  };
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
  const nextTriggerAt = computeNextTriggerAt(parsed.data.timeframe, parsed.data.timezone, now);

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
    .select("timeframe, timezone")
    .eq("id", reminderId)
    .eq("user_id", user.id)
    .maybeSingle<Pick<GraphReminder, "timeframe" | "timezone">>();

  if (fetchError || !existing) {
    return { error: "Reminder not found." };
  }

  // Recompute next_trigger_at only when timeframe or timezone actually
  // changed — an edit that only touches description/enabled shouldn't
  // reset the reminder's schedule.
  const scheduleChanged =
    existing.timeframe !== parsed.data.timeframe || existing.timezone !== parsed.data.timezone;

  const update: Record<string, unknown> = { ...parsed.data };
  if (scheduleChanged) {
    const nextTriggerAt = computeNextTriggerAt(
      parsed.data.timeframe,
      parsed.data.timezone,
      new Date(),
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
