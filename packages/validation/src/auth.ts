import { z } from "zod";

/**
 * Signup/login form validation. Supabase enforces its own password policy
 * server-side; this is client/server-action-level input hygiene, not a
 * substitute for it.
 */
export const signUpSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, { message: "Password must be at least 8 characters" }),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

export const logInSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1, { message: "Password is required" }),
});

export type LogInInput = z.infer<typeof logInSchema>;
