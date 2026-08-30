"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { createAlertAction, type AlertFormState } from "../../actions";

const initialState: AlertFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Creating..." : "Create alert"}
    </button>
  );
}

export default function NewAlertPage() {
  const [state, formAction] = useFormState(createAlertAction, initialState);

  return (
    <main>
      <div className="card">
        <h1>New XAUUSD alert</h1>
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
              required
            />
          </div>

          <div className="field">
            <label htmlFor="direction">Direction</label>
            <select id="direction" name="direction" defaultValue="CROSS_UP" required>
              <option value="CROSS_UP">Crosses up</option>
              <option value="CROSS_DOWN">Crosses down</option>
              <option value="CROSS_BOTH">Crosses up or down</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="trigger_mode">Trigger mode</label>
            <select id="trigger_mode" name="trigger_mode" defaultValue="ONCE" required>
              <option value="ONCE">Once</option>
              <option value="EVERY_TIME">Every time</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="expiration_at">Expires at (optional)</label>
            <input id="expiration_at" name="expiration_at" type="datetime-local" />
          </div>

          <div className="field">
            <label htmlFor="message">Message (optional)</label>
            <textarea id="message" name="message" rows={3} maxLength={500} />
          </div>

          <div className="field">
            <label htmlFor="enabled">
              <input id="enabled" name="enabled" type="checkbox" defaultChecked /> Enabled
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
    </main>
  );
}
