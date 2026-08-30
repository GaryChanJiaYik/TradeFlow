"use server";

import { redirect } from "next/navigation";
import { signUpSchema, logInSchema } from "@tradeflow/validation";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState = {
  error?: string;
  notice?: string;
};

export async function signUpAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: error.message };
  }

  // If email confirmation is disabled on the Supabase project, signUp
  // returns an active session immediately and we can go straight in.
  if (data.session) {
    redirect("/dashboard");
  }

  return {
    notice: "Account created. Check your email to confirm before logging in.",
  };
}

export async function logInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = logInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Invalid email or password." };
  }

  redirect("/dashboard");
}

export async function logOutAction() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
