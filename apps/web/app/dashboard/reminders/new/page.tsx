import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewReminderForm } from "./new-reminder-form";

export default async function NewReminderPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main>
      <NewReminderForm />
    </main>
  );
}
