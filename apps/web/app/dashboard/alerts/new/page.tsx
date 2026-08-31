import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewAlertForm } from "./new-alert-form";

export default async function NewAlertPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main>
      <NewAlertForm />
    </main>
  );
}
