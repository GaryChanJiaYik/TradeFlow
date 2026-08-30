import Link from "next/link";
import { redirect } from "next/navigation";
import type { PriceAlert } from "@tradeflow/types";
import { createClient } from "@/lib/supabase/server";
import { logOutAction } from "@/app/auth/actions";
import { setAlertEnabledAction, deleteAlertAction } from "./actions";
import { NotificationsControl } from "./notifications-control";

type AlertRow = PriceAlert & { instruments: { symbol: string; name: string } | null };

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: alerts, error } = await supabase
    .from("price_alerts")
    .select("*, instruments(symbol, name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .returns<AlertRow[]>();

  return (
    <main>
      <div className="top-bar">
        <div>
          <h1>Your alerts</h1>
          <p className="muted">{user.email}</p>
        </div>
        <div className="actions">
          <Link className="btn" href="/dashboard/alerts/new">
            New alert
          </Link>
          <form action={logOutAction}>
            <button className="btn btn-secondary" type="submit">
              Log out
            </button>
          </form>
        </div>
      </div>

      <NotificationsControl />

      <div className="card">
        {error && <div className="form-error">Could not load alerts.</div>}

        {!error && (!alerts || alerts.length === 0) && (
          <p className="muted">No alerts yet. Create your first XAUUSD alert.</p>
        )}

        {!error && alerts && alerts.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Target</th>
                <th>Direction</th>
                <th>Mode</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id}>
                  <td>{alert.instruments?.symbol ?? "XAUUSD"}</td>
                  <td>{alert.target_price}</td>
                  <td>{alert.direction}</td>
                  <td>{alert.trigger_mode}</td>
                  <td>{formatDate(alert.expiration_at)}</td>
                  <td>
                    <span className={`badge ${alert.enabled ? "badge-on" : "badge-off"}`}>
                      {alert.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td>
                    <div className="actions">
                      <Link className="btn btn-secondary" href={`/dashboard/alerts/${alert.id}/edit`}>
                        Edit
                      </Link>
                      <form action={setAlertEnabledAction}>
                        <input type="hidden" name="alertId" value={alert.id} />
                        <input
                          type="hidden"
                          name="nextEnabled"
                          value={(!alert.enabled).toString()}
                        />
                        <button className="btn btn-secondary" type="submit">
                          {alert.enabled ? "Disable" : "Enable"}
                        </button>
                      </form>
                      <form action={deleteAlertAction}>
                        <input type="hidden" name="alertId" value={alert.id} />
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
