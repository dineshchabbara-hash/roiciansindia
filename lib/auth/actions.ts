"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { isRole, roleHomePath } from "@/lib/domain/rbac";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";

export type AuthActionState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  success?: boolean;
};

const LOGIN_RATE_LIMIT = { limit: 5, windowSeconds: 15 * 60 };
const RESET_RATE_LIMIT = { limit: 3, windowSeconds: 15 * 60 };

// Generic, safe messages only — never leak which field was wrong, whether an
// account exists, or any provider/database detail (SECURITY_PLAN.md §12).
const INVALID_CREDENTIALS = "Invalid email or password.";
const TOO_MANY_ATTEMPTS = "Too many attempts. Please try again in a few minutes.";
const ACCOUNT_NOT_SET_UP =
  "Your account is not fully set up yet. Please contact an administrator.";

export async function signInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { email, password } = parsed.data;

  const rateLimit = await checkRateLimit(
    `login:${email.toLowerCase()}`,
    LOGIN_RATE_LIMIT,
  );
  if (!rateLimit.allowed) {
    return { formError: TOO_MANY_ATTEMPTS };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { formError: INVALID_CREDENTIALS };
  }

  const { data: userRole } = await supabase
    .from("user_roles")
    .select("role")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();

  if (!userRole || !isRole(userRole.role)) {
    // Never leave an authenticated session around with an unresolvable role.
    await supabase.auth.signOut();
    return { formError: ACCOUNT_NOT_SET_UP };
  }

  redirect(roleHomePath(userRole.role));
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordResetAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { email } = parsed.data;

  const rateLimit = await checkRateLimit(
    `forgot-password:${email.toLowerCase()}`,
    RESET_RATE_LIMIT,
  );
  if (!rateLimit.allowed) {
    // Still return the generic success message below (not the rate-limit
    // message) — even rate-limit state must not reveal whether the address
    // is real. The delay is enough of a brake; the two outcomes look
    // identical to the caller.
    return { success: true };
  }

  const supabase = await createSupabaseServerClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Errors are intentionally not surfaced — whether this address has an
  // account must not be observable from the response (anti-enumeration).
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/auth/callback?next=/reset-password`,
  });

  return { success: true };
}

export async function updatePasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createSupabaseServerClient();

  // Requires an active recovery session, established by /auth/callback
  // exchanging the emailed link's code beforehand.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      formError: "Your password reset link has expired. Please request a new one.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return { formError: "Could not update your password. Please try again." };
  }

  await supabase.auth.signOut();
  redirect("/login?passwordUpdated=1");
}
