"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { signUpAction, type AuthActionState } from "@/app/auth/actions";

const initialState: AuthActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Creating account..." : "Sign up"}
    </button>
  );
}

export default function SignUpPage() {
  const [state, formAction] = useFormState(signUpAction, initialState);

  return (
    <main>
      <div className="card">
        <h1>Sign up</h1>
        {state.error && <div className="form-error">{state.error}</div>}
        {state.notice && <div className="form-notice">{state.notice}</div>}
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
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <SubmitButton />
        </form>
        <p className="muted">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </div>
    </main>
  );
}
