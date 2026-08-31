import { notFound, redirect } from "next/navigation";
import type { GraphReminder } from "@tradeflow/types";
import { createClient } from "@/lib/supabase/server";
import { EditReminderForm } from "./edit-form";

export default async function EditReminderPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: reminder } = await supabase
    .from("graph_reminders")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle<GraphReminder>();

  if (!reminder) {
    notFound();
  }

  return (
    <main>
      <EditReminderForm reminder={reminder} />
    </main>
  );
}
