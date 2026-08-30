import { notFound, redirect } from "next/navigation";
import type { PriceAlert } from "@tradeflow/types";
import { createClient } from "@/lib/supabase/server";
import { EditAlertForm } from "./edit-form";

export default async function EditAlertPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: alert } = await supabase
    .from("price_alerts")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle<PriceAlert>();

  if (!alert) {
    notFound();
  }

  return (
    <main>
      <EditAlertForm alert={alert} />
    </main>
  );
}
