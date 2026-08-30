"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPriceAlertSchema, updatePriceAlertSchema } from "@tradeflow/validation";
import { createClient } from "@/lib/supabase/server";

export type AlertFormState = {
  error?: string;
};

const XAUUSD_SYMBOL = "XAUUSD";

/**
 * Step 1 has exactly one tradable instrument and the UI never lets a user
 * pick a different one, so every alert create/edit resolves it by symbol
 * rather than taking it as form input.
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

function readAlertFormFields(formData: FormData) {
  const expirationRaw = formData.get("expiration_at");
  const messageRaw = formData.get("message");
  return {
    target_price: Number(formData.get("target_price")),
    direction: formData.get("direction"),
    trigger_mode: formData.get("trigger_mode"),
    expiration_at:
      typeof expirationRaw === "string" && expirationRaw.trim() !== ""
        ? (() => {
            const parsed = new Date(expirationRaw);
            return Number.isNaN(parsed.getTime()) ? expirationRaw : parsed.toISOString();
          })()
        : null,
    message: typeof messageRaw === "string" && messageRaw.trim() !== "" ? messageRaw : null,
    enabled: formData.get("enabled") === "on",
  };
}

export async function createAlertAction(
  _prevState: AlertFormState,
  formData: FormData,
): Promise<AlertFormState> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = createPriceAlertSchema.omit({ instrument_id: true }).safeParse(
    readAlertFormFields(formData),
  );
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const instrument = await getXauUsdInstrumentId(supabase);
  if ("error" in instrument) return { error: instrument.error };

  const { error } = await supabase.from("price_alerts").insert({
    user_id: user.id,
    instrument_id: instrument.id,
    ...parsed.data,
  });

  if (error) {
    return { error: "Could not create alert. Please try again." };
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function updateAlertAction(
  alertId: string,
  _prevState: AlertFormState,
  formData: FormData,
): Promise<AlertFormState> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = updatePriceAlertSchema.safeParse(readAlertFormFields(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { error } = await supabase
    .from("price_alerts")
    .update(parsed.data)
    .eq("id", alertId)
    .eq("user_id", user.id);

  if (error) {
    return { error: "Could not update alert. Please try again." };
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function setAlertEnabledAction(formData: FormData): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const alertId = formData.get("alertId");
  const nextEnabled = formData.get("nextEnabled") === "true";
  if (typeof alertId !== "string") return;

  await supabase
    .from("price_alerts")
    .update({ enabled: nextEnabled })
    .eq("id", alertId)
    .eq("user_id", user.id);

  revalidatePath("/dashboard");
}

export async function deleteAlertAction(formData: FormData): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const alertId = formData.get("alertId");
  if (typeof alertId !== "string") return;

  await supabase.from("price_alerts").delete().eq("id", alertId).eq("user_id", user.id);

  revalidatePath("/dashboard");
}
