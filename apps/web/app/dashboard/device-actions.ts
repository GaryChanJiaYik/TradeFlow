"use server";

import { revalidatePath } from "next/cache";
import { upsertDeviceSchema } from "@tradeflow/validation";
import { createClient } from "@/lib/supabase/server";

export type DeviceActionState = {
  error?: string;
  success?: boolean;
};

/**
 * Upserts the browser's Web Push `PushSubscription` into `devices` for the
 * signed-in user. Called directly from a client component (not bound to a
 * <form>), so it takes plain data rather than FormData.
 *
 * Uses the request-scoped (anon-key + user session) Supabase client, not
 * the service role — this is a user-initiated write, so RLS plus this
 * explicit `.eq("user_id", user.id)` scoping both apply, matching the
 * defense-in-depth pattern used throughout `actions.ts`.
 *
 * "Upsert" here is application-level (find-then-update-or-insert on the
 * subscription's endpoint), not a DB-level `ON CONFLICT` — there is no
 * unique constraint on `devices.subscription`, and adding one for a single
 * JSONB path was judged more schema churn than this step needs. A user
 * re-subscribing (e.g. after browser data was cleared, or after a device
 * row was disabled following a 404/410 from the push service) re-enables
 * and refreshes the existing row for that endpoint instead of accumulating
 * duplicates.
 */
export async function upsertDeviceAction(subscriptionJson: unknown): Promise<DeviceActionState> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const parsed = upsertDeviceSchema.safeParse({ platform: "web", subscription: subscriptionJson });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid push subscription." };
  }

  const nowIso = new Date().toISOString();
  const { subscription, platform } = parsed.data;

  const { data: existing } = await supabase
    .from("devices")
    .select("id")
    .eq("user_id", user.id)
    .eq("subscription->>endpoint", subscription.endpoint)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from("devices")
        .update({ subscription, platform, enabled: true, last_seen_at: nowIso })
        .eq("id", existing.id)
        .eq("user_id", user.id)
    : await supabase.from("devices").insert({
        user_id: user.id,
        platform,
        subscription,
        enabled: true,
        last_seen_at: nowIso,
      });

  if (error) {
    return { error: "Could not save this device. Please try again." };
  }

  revalidatePath("/dashboard");
  return { success: true };
}
