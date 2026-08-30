import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main>
      <div className="card">
        <h1>TradeFlow</h1>
        <p className="muted">Price alerts and trading reminders for XAUUSD.</p>
        <div className="actions">
          <Link className="btn" href="/login">
            Log in
          </Link>
          <Link className="btn btn-secondary" href="/signup">
            Sign up
          </Link>
        </div>
      </div>
    </main>
  );
}
