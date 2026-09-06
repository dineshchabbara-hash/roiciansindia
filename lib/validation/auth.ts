import { z } from "zod";

/**
 * Shared between client-side form feedback and server-side enforcement in
 * the corresponding Server Action — the server-side run is mandatory
 * (SECURITY_PLAN.md §4); the client-side run is for UX only.
 */

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

// A minimum length is enforced here; Supabase Auth's own project-level
// password policy is the second, authoritative check (SECURITY_PLAN.md §2).
export const resetPasswordSchema = z
  .object({
    password: z.string().min(10, "Password must be at least 10 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
