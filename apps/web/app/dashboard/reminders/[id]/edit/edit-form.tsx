"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import type { GraphReminder } from "@tradeflow/types";
import { updateReminderAction, type ReminderFormState } from "../../../reminder-actions";

const initialState: ReminderFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Saving..." : "Save changes"}
    </button>
  );
}

export function EditReminderForm({ reminder }: { reminder: GraphReminder }) {
  const boundAction = updateReminderAction.bind(null, reminder.id);
  const [state, formAction] = useFormState(boundAction, initialState);

  return (
    <div className="card">
      <h1>Edit reminder</h1>
      {state.error && <div className="form-error">{state.error}</div>}
      <form action={formAction}>
        <div className="field">
          <label htmlFor="timeframe">Timeframe</label>
          <select id="timeframe" name="timeframe" defaultValue={reminder.timeframe} required>
            <option value="15m">15 minutes</option>
            <option value="1H">1 hour</option>
            <option value="4H">4 hours</option>
            <option value="1D">1 day</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="description">Description (optional)</label>
          <textarea
            id="description"
            name="description"
            rows={3}
            maxLength={500}
            defaultValue={reminder.description ?? ""}
          />
        </div>

        <div className="field">
          <label htmlFor="timezone">Timezone</label>
          <input
            id="timezone"
            name="timezone"
            type="text"
            defaultValue={reminder.timezone}
            placeholder="e.g. Asia/Kuala_Lumpur"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="enabled">
            <input id="enabled" name="enabled" type="checkbox" defaultChecked={reminder.enabled} />{" "}
            Enabled
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
