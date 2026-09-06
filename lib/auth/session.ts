import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isRole, type Role } from "@/lib/domain/rbac";

export type UserContext = {
  authUserId: string;
  email: string | null;
  role: Role;
  /** The row id in students/trainers/admins for this user, if resolved. */
  profileId: string | null;
  displayName: string | null;
};

/**
 * Resolves the current request's authenticated user and application role.
 * Returns null for "not authenticated" AND for any unexpected error —
 * fails closed, per SECURITY_PLAN.md: an unreachable Supabase project or a
 * malformed session must never be treated as "authorized", only ever as
 * "not authenticated".
 *
 * This is the single place route-group layouts and server actions call to
 * find out who's asking — never re-implement this lookup inline.
 */
export async function getCurrentUserContext(): Promise<UserContext | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return null;
    }

    const { data: userRole, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (roleError || !userRole || !isRole(userRole.role)) {
      return null;
    }

    const role = userRole.role;
    const { profileId, displayName } = await resolveProfile(supabase, role, user.id);

    return {
      authUserId: user.id,
      email: user.email ?? null,
      role,
      profileId,
      displayName,
    };
  } catch {
    return null;
  }
}

async function resolveProfile(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  role: Role,
  authUserId: string,
): Promise<{ profileId: string | null; displayName: string | null }> {
  const table =
    role === "trainer" ? "trainers" : role === "student" ? "students" : "admins";

  const { data, error } = await supabase
    .from(table)
    .select("id, first_name, last_name")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error || !data) {
    return { profileId: null, displayName: null };
  }

  return {
    profileId: data.id as string,
    displayName: `${data.first_name} ${data.last_name}`,
  };
}
