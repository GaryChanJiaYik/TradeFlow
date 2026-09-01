"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { createReminderAction, type ReminderFormState } from "../../reminder-actions";

const initialState: ReminderFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Creating..." : "Create reminder"}
    </button>
  );
}

export function NewReminderForm() {
  const [state, formAction] = useFormState(createReminderAction, initialState);

  // Defaults to the browser's detected zone, but only after mount — starting
  // from "" on both server and client render avoids a hydration mismatch
  // (the server has no meaningful notion of "the user's browser timezone").
  const [timezone, setTimezone] = useState("");
  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  return (
    <div className="card">
      <h1>New XAUUSD chart reminder</h1>
      {state.error && <div className="form-error">{state.error}</div>}
      <form action={formAction}>
        <div className="field">
          <label htmlFor="timeframe">Timeframe</label>
          <select id="timeframe" name="timeframe" defaultValue="1H" required>
            <option value="15m">15 minutes</option>
            <option value="1H">1 hour</option>
            <option value="4H">4 hours</option>
            <option value="1D">1 day</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="description">Description (optional)</label>
          <textarea id="description" name="description" rows={3} maxLength={500} />
        </div>

        <div className="field">
          <label htmlFor="timezone">Timezone</label>
          <input
            id="timezone"
            name="timezone"
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="e.g. Asia/Kuala_Lumpur"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="window_start_time">Market open (optional)</label>
          <input id="window_start_time" name="window_start_time" type="time" />
        </div>

        <div className="field">
          <label htmlFor="window_end_time">Market close (optional)</label>
          <input id="window_end_time" name="window_end_time" type="time" />
        </div>
        <p className="muted">
          When both are set, this reminder only fires within that window each day. Leave both
          blank for no restriction.
        </p>

        <div className="field">
          <label htmlFor="enabled">
            <input id="enabled" name="enabled" type="checkbox" defaultChecked /> Enabled
          </label>
        </div>

        <div className="actions">
          <SubmitButton />
          <Link className="btn btn-secondary" href="/dashboard/reminders">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
