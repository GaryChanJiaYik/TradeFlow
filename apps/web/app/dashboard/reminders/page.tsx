import Link from "next/link";
import { redirect } from "next/navigation";
import type { GraphReminder } from "@tradeflow/types";
import { createClient } from "@/lib/supabase/server";
import { logOutAction } from "@/app/auth/actions";
import { setReminderEnabledAction, deleteReminderAction } from "../reminder-actions";

type ReminderRow = GraphReminder & { instruments: { symbol: string; name: string } | null };

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export default async function RemindersPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: reminders, error } = await supabase
    .from("graph_reminders")
    .select("*, instruments(symbol, name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .returns<ReminderRow[]>();

  return (
    <main>
      <div className="top-bar">
        <div>
          <h1>Your chart reminders</h1>
          <p className="muted">{user.email}</p>
        </div>
        <div className="actions">
          <Link className="btn btn-secondary" href="/dashboard">
            Alerts
          </Link>
          <Link className="btn" href="/dashboard/reminders/new">
            New reminder
          </Link>
          <form action={logOutAction}>
            <button className="btn btn-secondary" type="submit">
              Log out
            </button>
          </form>
        </div>
      </div>

      <div className="card">
        {error && <div className="form-error">Could not load reminders.</div>}

        {!error && (!reminders || reminders.length === 0) && (
          <p className="muted">No reminders yet. Create your first XAUUSD chart reminder.</p>
        )}

        {!error && reminders && reminders.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Timeframe</th>
                <th>Description</th>
                <th>Next occurrence</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reminders.map((reminder) => (
                <tr key={reminder.id}>
                  <td>{reminder.instruments?.symbol ?? "XAUUSD"}</td>
                  <td>{reminder.timeframe}</td>
                  <td>{reminder.description || "—"}</td>
                  <td>{formatDate(reminder.next_trigger_at)}</td>
                  <td>
                    <span className={`badge ${reminder.enabled ? "badge-on" : "badge-off"}`}>
                      {reminder.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td>
                    <div className="actions">
                      <Link
                        className="btn btn-secondary"
                        href={`/dashboard/reminders/${reminder.id}/edit`}
                      >
                        Edit
                      </Link>
                      <form action={setReminderEnabledAction}>
                        <input type="hidden" name="reminderId" value={reminder.id} />
                        <input
                          type="hidden"
                          name="nextEnabled"
                          value={(!reminder.enabled).toString()}
                        />
                        <button className="btn btn-secondary" type="submit">
                          {reminder.enabled ? "Disable" : "Enable"}
                        </button>
                      </form>
                      <form action={deleteReminderAction}>
                        <input type="hidden" name="reminderId" value={reminder.id} />
                        <button className="btn btn-danger" type="submit">
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
