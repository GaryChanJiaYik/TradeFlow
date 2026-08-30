"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { logInAction, type AuthActionState } from "@/app/auth/actions";

const initialState: AuthActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Logging in..." : "Log in"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState(logInAction, initialState);

  return (
    <main>
      <div className="card">
        <h1>Log in</h1>
        {state.error && <div className="form-error">{state.error}</div>}
        <form action={formAction}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          <SubmitButton />
        </form>
        <p className="muted">
          No account? <Link href="/signup">Sign up</Link>
        </p>
      </div>
    </main>
  );
}
