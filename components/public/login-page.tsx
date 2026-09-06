import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { roleHomePath } from "@/lib/domain/rbac";
import { LoginForm } from "@/components/public/login-form";
import { AuthCard } from "@/components/public/auth-card";

/**
 * Shared body for the generic /login page and the three role-specific
 * entry points (/login/student, /login/trainer, /login/admin). All four
 * authenticate against the same Supabase Auth backend and redirect by the
 * user's ACTUAL role after sign-in, not by which page they used to log in
 * (ARCHITECTURE.md §6) — the distinct pages are purely cosmetic/contextual.
 */
export async function LoginPage({
  title,
  description,
  notice,
}: {
  title: string;
  description: string;
  notice?: string;
}) {
  const user = await getCurrentUserContext();
  if (user) {
    redirect(roleHomePath(user.role));
  }

  return (
    <AuthCard title={title} description={description}>
      {notice && (
        <p className="mb-4 text-sm text-green-700 dark:text-green-500">{notice}</p>
      )}
      <LoginForm />
    </AuthCard>
  );
}
