"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import type { PriceAlert } from "@tradeflow/types";
import { updateAlertAction, type AlertFormState } from "../../../actions";

const initialState: AlertFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Saving..." : "Save changes"}
    </button>
  );
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function EditAlertForm({ alert }: { alert: PriceAlert }) {
  const boundAction = updateAlertAction.bind(null, alert.id);
  const [state, formAction] = useFormState(boundAction, initialState);

  return (
    <div className="card">
      <h1>Edit alert</h1>
      {state.error && <div className="form-error">{state.error}</div>}
      <form action={formAction}>
        <div className="field">
          <label htmlFor="target_price">Target price</label>
          <input
            id="target_price"
            name="target_price"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={alert.target_price}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="direction">Direction</label>
          <select id="direction" name="direction" defaultValue={alert.direction} required>
            <option value="CROSS_UP">Crosses up</option>
            <option value="CROSS_DOWN">Crosses down</option>
            <option value="CROSS_BOTH">Crosses up or down</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="trigger_mode">Trigger mode</label>
          <select id="trigger_mode" name="trigger_mode" defaultValue={alert.trigger_mode} required>
            <option value="ONCE">Once</option>
            <option value="EVERY_TIME">Every time</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="expiration_at">Expires at (optional)</label>
          <input
            id="expiration_at"
            name="expiration_at"
            type="datetime-local"
            defaultValue={toDatetimeLocalValue(alert.expiration_at)}
          />
        </div>

        <div className="field">
          <label htmlFor="message">Message (optional)</label>
          <textarea id="message" name="message" rows={3} maxLength={500} defaultValue={alert.message ?? ""} />
        </div>

        <div className="field">
          <label htmlFor="enabled">
            <input id="enabled" name="enabled" type="checkbox" defaultChecked={alert.enabled} /> Enabled
          </label>
        </div>

        <div className="actions">
          <SubmitButton />
          <Link className="btn btn-secondary" href="/dashboard">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
