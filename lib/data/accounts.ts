import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DataResult } from "@/lib/data/dashboard";
import {
  ADMIN_LINK_MESSAGES,
  STUDENT_LINK_MESSAGES,
  canAdoptLogin,
  normalizeEmail,
  portalAccessState,
  type ExistingLogin,
  type PortalAccessState,
} from "@/lib/domain/accounts";

/**
 * Phase 21C — Student portal access (DECISIONS_NEEDED D3, option b) and
 * Admin accounts (Super Admin only).
 *
 * Callers (server actions) verify the session role first. Profiles are read
 * through the caller's own session (RLS); the login itself is created with
 * the Auth admin API and linked by the service-role-only database
 * functions from migration 39, which fix the role (student / admin), lock
 * the profile row and are idempotent. A login is created WITHOUT a
 * password — the person sets their own through the reset-password flow —
 * so no password exists anywhere in this code.
 *
 * Partial failure: a login created by this request is deleted again if
 * linking does not succeed, so a retry starts clean; a login left behind by
 * a crash in between has no role, no link and no password, and the next
 * attempt adopts it instead of creating a duplicate (canAdoptLogin).
 */

const DEACTIVATED_BAN = "876000h"; // ~100 years: effectively until reactivated

function log(message: string, error?: unknown) {
  if (error === undefined) console.error(`[accounts] ${message}`);
  else console.error(`[accounts] ${message}:`, error);
}

type FindRow = {
  auth_user_id: string;
  has_password: boolean;
  last_sign_in_at: string | null;
  role: string | null;
  student_id: string | null;
  trainer_id: string | null;
  admin_id: string | null;
};

async function findLogin(email: string): Promise<ExistingLogin | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("find_auth_account", { p_email: email });
  if (error) throw error;
  const row = (data as FindRow[] | null)?.[0];
  if (!row) return null;
  return {
    authUserId: row.auth_user_id,
    hasPassword: row.has_password,
    role: row.role,
    studentId: row.student_id,
    trainerId: row.trainer_id,
    adminId: row.admin_id,
  };
}

type LoginResolution =
  | { kind: "ready"; authUserId: string; createdNow: boolean }
  | { kind: "existing"; login: ExistingLogin };

/**
 * A login for `email` that is safe to link: a newly created one (no
 * password) or an adoptable leftover. Any other existing login is returned
 * as-is for the caller to classify — it is never modified here.
 */
async function resolveLogin(email: string): Promise<LoginResolution> {
  const existing = await findLogin(email);
  if (existing) {
    return canAdoptLogin(existing)
      ? { kind: "ready", authUserId: existing.authUserId, createdNow: false }
      : { kind: "existing", login: existing };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    // Another request created the same login a moment ago: classify that one.
    const raced = await findLogin(email);
    if (raced) {
      return canAdoptLogin(raced)
        ? { kind: "ready", authUserId: raced.authUserId, createdNow: false }
        : { kind: "existing", login: raced };
    }
    throw error ?? new Error("createUser returned no user");
  }
  return { kind: "ready", authUserId: data.user.id, createdNow: true };
}

/**
 * Removes a login this request created when linking did not succeed — but
 * only while it is still unlinked: a concurrent request may have adopted
 * and linked it in the meantime, and that link must survive.
 */
async function discardCreatedLogin(authUserId: string, email: string) {
  try {
    const current = await findLogin(email);
    if (current && current.authUserId === authUserId && !canAdoptLogin(current)) return;
    const { error } = await createSupabaseAdminClient().auth.admin.deleteUser(authUserId);
    if (error) log("Could not remove a login created by a failed provisioning", error);
  } catch (error) {
    log("Could not check a login before removing it", error);
  }
}

type ActivityRow = {
  auth_user_id: string;
  has_password: boolean;
  last_sign_in_at: string | null;
};

async function loginActivity(
  authUserIds: string[],
): Promise<Map<string, { hasPassword: boolean; lastSignInAt: string | null }>> {
  const result = new Map<string, { hasPassword: boolean; lastSignInAt: string | null }>();
  if (authUserIds.length === 0) return result;
  const { data, error } = await createSupabaseAdminClient().rpc("auth_account_activity", {
    p_auth_user_ids: authUserIds,
  });
  if (error) throw error;
  for (const row of (data as ActivityRow[] | null) ?? []) {
    result.set(row.auth_user_id, {
      hasPassword: row.has_password,
      lastSignInAt: row.last_sign_in_at,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Student portal access

type StudentRow = {
  id: string;
  student_code: string;
  email: string | null;
  status: string;
  auth_user_id: string | null;
};

async function readStudent(studentId: string): Promise<StudentRow | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("students")
    .select("id, student_code, email, status, auth_user_id")
    .eq("id", studentId)
    .maybeSingle();
  if (error) throw error;
  return (data as StudentRow | null) ?? null;
}

/** The student's portal-login state, for the Admin student page. */
export async function getStudentPortalAccess(
  studentId: string,
): Promise<DataResult<PortalAccessState>> {
  try {
    const student = await readStudent(studentId);
    if (!student) return { ok: false, error: "Student not found." };
    if (!student.auth_user_id) return { ok: true, data: { status: "none" } };
    const activity = await loginActivity([student.auth_user_id]);
    const { data: authUser } = await createSupabaseAdminClient().auth.admin.getUserById(
      student.auth_user_id,
    );
    return {
      ok: true,
      data: portalAccessState(
        true,
        authUser?.user?.email ?? student.email,
        activity.get(student.auth_user_id) ?? null,
      ),
    };
  } catch (error) {
    log("Could not load portal access", error);
    return { ok: false, error: "Could not load portal access." };
  }
}

export type StudentProvisioningResult = {
  outcome: "linked" | "already_linked";
  studentCode: string;
  email: string;
};

export async function provisionStudentPortalAccess(
  studentId: string,
): Promise<DataResult<StudentProvisioningResult>> {
  let createdNow: string | null = null;
  let email = "";
  try {
    const student = await readStudent(studentId);
    if (!student) return { ok: false, error: STUDENT_LINK_MESSAGES.student_not_found };
    if (student.auth_user_id) {
      return {
        ok: true,
        data: {
          outcome: "already_linked",
          studentCode: student.student_code,
          email: student.email ?? "",
        },
      };
    }
    if (student.status !== "active") {
      return { ok: false, error: STUDENT_LINK_MESSAGES.student_inactive };
    }
    if (!student.email) {
      return {
        ok: false,
        error: "Add the student's email address first — it becomes their login.",
      };
    }
    email = normalizeEmail(student.email);

    const login = await resolveLogin(email);
    if (login.kind === "existing") {
      if (login.login.studentId === studentId) {
        return {
          ok: true,
          data: { outcome: "already_linked", studentCode: student.student_code, email },
        };
      }
      return { ok: false, error: STUDENT_LINK_MESSAGES.account_in_use };
    }
    if (login.createdNow) createdNow = login.authUserId;

    const { data, error } = await createSupabaseAdminClient().rpc(
      "link_student_portal_account",
      { p_student_id: studentId, p_auth_user_id: login.authUserId },
    );
    if (error) throw error;
    const outcome = String(data);
    if (outcome === "linked" || outcome === "already_linked") {
      createdNow = null;
      return {
        ok: true,
        data: { outcome, studentCode: student.student_code, email },
      };
    }
    if (createdNow) await discardCreatedLogin(createdNow, email);
    createdNow = null;
    return {
      ok: false,
      error: STUDENT_LINK_MESSAGES[outcome] ?? "Portal access could not be given.",
    };
  } catch (error) {
    if (createdNow) await discardCreatedLogin(createdNow, email);
    log("Could not provision portal access", error);
    return { ok: false, error: "Portal access could not be given. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Admin accounts (Super Admin)

export type AdminAccountRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roleLevel: "admin" | "super_admin";
  status: "active" | "inactive";
  createdAt: string;
  access: PortalAccessState;
};

type AdminDbRow = {
  id: string;
  auth_user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role_level: "admin" | "super_admin";
  status: "active" | "inactive";
  created_at: string;
};

/** Every admin profile the caller's RLS shows (Super Admin: all). */
export async function listAdminAccounts(): Promise<DataResult<AdminAccountRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("admins")
      .select(
        "id, auth_user_id, first_name, last_name, email, role_level, status, created_at",
      )
      .order("role_level", { ascending: false })
      .order("last_name", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;
    const rows = (data as AdminDbRow[] | null) ?? [];
    const activity = await loginActivity(rows.map((r) => r.auth_user_id));
    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        roleLevel: r.role_level,
        status: r.status,
        createdAt: r.created_at,
        access: portalAccessState(true, r.email, activity.get(r.auth_user_id) ?? null),
      })),
    };
  } catch (error) {
    log("Could not load admin accounts", error);
    return { ok: false, error: "Could not load admin accounts." };
  }
}

export type AdminCreationResult = {
  outcome: "created" | "already_admin";
  adminId: string;
  email: string;
};

export async function createAdminAccount(input: {
  firstName: string;
  lastName: string;
  email: string;
}): Promise<DataResult<AdminCreationResult>> {
  let createdNow: string | null = null;
  const email = normalizeEmail(input.email);
  try {
    const login = await resolveLogin(email);
    if (login.kind === "existing") {
      if (login.login.adminId && login.login.role === "admin") {
        return {
          ok: true,
          data: { outcome: "already_admin", adminId: login.login.adminId, email },
        };
      }
      return { ok: false, error: ADMIN_LINK_MESSAGES.account_in_use };
    }
    if (login.createdNow) createdNow = login.authUserId;

    const { data, error } = await createSupabaseAdminClient().rpc("link_admin_account", {
      p_auth_user_id: login.authUserId,
      p_first_name: input.firstName,
      p_last_name: input.lastName,
      p_email: email,
    });
    if (error) throw error;
    const row = (data as Array<{ admin_id: string | null; outcome: string }> | null)?.[0];
    if (
      row &&
      row.admin_id &&
      (row.outcome === "created" || row.outcome === "already_admin")
    ) {
      createdNow = null;
      return {
        ok: true,
        data: { outcome: row.outcome, adminId: row.admin_id, email },
      };
    }
    if (createdNow) await discardCreatedLogin(createdNow, email);
    createdNow = null;
    return {
      ok: false,
      error:
        ADMIN_LINK_MESSAGES[row?.outcome ?? ""] ??
        "The admin account could not be created.",
    };
  } catch (error) {
    if (createdNow) await discardCreatedLogin(createdNow, email);
    log("Could not create an admin account", error);
    return {
      ok: false,
      error: "The admin account could not be created. Please try again.",
    };
  }
}

export type AdminStatusResult = {
  outcome: "updated" | "unchanged";
  email: string | null;
};

/**
 * Activates/deactivates a plain Admin. The database change takes effect at
 * once (is_admin_or_super() ignores an inactive admin); the login is also
 * banned/unbanned so a deactivated admin cannot sign in again.
 */
export async function setAdminAccountStatus(
  adminId: string,
  status: "active" | "inactive",
): Promise<DataResult<AdminStatusResult>> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("set_admin_account_status", {
      p_admin_id: adminId,
      p_status: status,
    });
    if (error) throw error;
    const row = (
      data as Array<{ auth_user_id: string | null; outcome: string }> | null
    )?.[0];
    if (!row || row.outcome === "not_found")
      return { ok: false, error: "Admin account not found." };
    if (row.outcome === "not_manageable") {
      return { ok: false, error: "Super Admin accounts cannot be changed here." };
    }
    if (row.auth_user_id) {
      const { error: banError } = await admin.auth.admin.updateUserById(
        row.auth_user_id,
        {
          ban_duration: status === "inactive" ? DEACTIVATED_BAN : "none",
        },
      );
      if (banError) log("Could not update the login's sign-in block", banError);
    }
    const { data: profile } = await admin
      .from("admins")
      .select("email")
      .eq("id", adminId)
      .maybeSingle();
    return {
      ok: true,
      data: {
        outcome: row.outcome === "updated" ? "updated" : "unchanged",
        email: (profile as { email: string } | null)?.email ?? null,
      },
    };
  } catch (error) {
    log("Could not change an admin account's status", error);
    return {
      ok: false,
      error: "The account status could not be changed. Please try again.",
    };
  }
}
