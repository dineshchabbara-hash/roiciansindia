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

// TEMP-DIAGNOSTIC(phase5-e2e): opt-in only (PHASE5_E2E_DEBUG_AUTH=1), never
// fires in normal operation. Added to pin down a real bug report — the
// synthetic E2E Admin's session gets rejected on the very next navigation
// after a successful login, while manual use in the same environment works
// — by surfacing *which* branch below returns null instead of guessing.
// Logs no token/secret values, only which check failed. Safe to delete once
// the root cause is confirmed from real output.
const DEBUG_AUTH = process.env.PHASE5_E2E_DEBUG_AUTH === "1";
function debugAuth(reason: string, detail?: unknown) {
  if (DEBUG_AUTH)
    console.error(`[phase5-e2e][getCurrentUserContext] ${reason}`, detail ?? "");
}

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
      debugAuth("no user from supabase.auth.getUser()", userError?.message);
      return null;
    }

    const { data: userRole, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (roleError || !userRole || !isRole(userRole.role)) {
      debugAuth("no resolvable role for authenticated user", {
        authUserId: user.id,
        roleError: roleError?.message,
        userRole,
      });
      return null;
    }

    const role = userRole.role;
    const { profileId, displayName, inactiveAdmin } = await resolveProfile(
      supabase,
      role,
      user.id,
    );
    // Phase 21C: a deactivated Admin is treated as not authenticated (the
    // database already denies them via is_admin_or_super()). Only an
    // explicitly inactive admins row counts — a role without a profile row
    // (the documented Super Admin bootstrap) is unaffected.
    if (inactiveAdmin) {
      debugAuth("admin account is deactivated", { authUserId: user.id });
      return null;
    }

    return {
      authUserId: user.id,
      email: user.email ?? null,
      role,
      profileId,
      displayName,
    };
  } catch (error) {
    debugAuth("threw", error instanceof Error ? error.message : error);
    return null;
  }
}

async function resolveProfile(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  role: Role,
  authUserId: string,
): Promise<{
  profileId: string | null;
  displayName: string | null;
  inactiveAdmin: boolean;
}> {
  const table =
    role === "trainer" ? "trainers" : role === "student" ? "students" : "admins";

  const { data, error } = await supabase
    .from(table)
    .select(
      table === "admins"
        ? "id, first_name, last_name, status"
        : "id, first_name, last_name",
    )
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error || !data) {
    return { profileId: null, displayName: null, inactiveAdmin: false };
  }

  const row = data as unknown as {
    id: string;
    first_name: string;
    last_name: string;
    status?: string;
  };
  return {
    profileId: row.id,
    displayName: `${row.first_name} ${row.last_name}`,
    inactiveAdmin: table === "admins" && row.status === "inactive",
  };
}
