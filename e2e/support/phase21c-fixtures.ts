import { randomBytes, randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * Node-side setup/teardown for the Phase 21C (LMS Administration &
 * Identity) E2E suite (e2e/phase21c-admin-identity.spec.ts).
 *
 * The service-role client creates and removes ONLY this suite's synthetic
 * rows and READS what the app produced. Logins provisioned by the running
 * app (a Student's portal login, an Admin created by a Super Admin) are
 * tracked by their exact email and removed by exact id. The single
 * company_settings row is snapshotted before the Settings test and
 * restored to exactly those values afterwards.
 *
 * Activation: a provisioned login has no password. The real person
 * requests a set-password email; the test cannot read an inbox, so it asks
 * the Auth admin API for the same one-time recovery token (generateLink)
 * and opens /auth/confirm with it — exactly the link a customised Supabase
 * email template would contain — then sets the password in the real
 * /reset-password form. The token is never printed.
 *
 * Markers: auth emails on @phase21c-e2e.internal.test; names start with
 * "Phase21CE2E" + RUN_ID.
 *
 * Cleanup is exact-id: admins rows (FK restrict) -> students -> auth users
 * (user_roles cascade). audit_logs are never touched.
 *
 * This is intentionally NOT a .spec.ts file.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export { hasRealSupabaseCredentials } from "./phase5-fixtures";

export const PHASE21C_E2E_EMAIL_DOMAIN = "phase21c-e2e.internal.test";
export const PHASE21C_E2E_PREFIX = "Phase21CE2E";
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function phase21cMarker(block: string): string {
  return `${PHASE21C_E2E_PREFIX}${RUN_ID}${block}`;
}

export function phase21cEmail(tag: string): string {
  return `phase21c-e2e-${tag.toLowerCase()}-${RUN_ID}@${PHASE21C_E2E_EMAIL_DOMAIN}`;
}

export function strongPassword(): string {
  return `P21c-${randomBytes(12).toString("base64url")}`;
}

function serviceClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing real Supabase credentials — call hasRealSupabaseCredentials() first.",
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function safely<T = unknown>(
  operation: () => PromiseLike<{ data?: T | null; error: { message: string } | null }>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    const result = await operation();
    return { data: result.data ?? null, error: result.error };
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  }
}

// Distinct phone block from every earlier phase's.
function syntheticPhone(): string {
  return `9909${randomInt(10, 100)}${randomInt(1000, 10000)}`.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tracked ids

export type Phase21CStaff = {
  authUserId: string;
  email: string;
  password: string;
  profileId: string | null;
  role: "admin" | "super_admin";
};

export type Phase21CTracked = {
  staff: Phase21CStaff[];
  studentIds: string[];
  /** Emails of logins the running app creates (student / admin). */
  appCreatedEmails: string[];
  settingsSnapshot: Record<string, unknown> | null;
};

export function newPhase21CTracked(): Phase21CTracked {
  return { staff: [], studentIds: [], appCreatedEmails: [], settingsSnapshot: null };
}

export async function createPhase21CStaff(
  tracked: Phase21CTracked,
  tag: string,
  role: "admin" | "super_admin",
): Promise<Phase21CStaff> {
  const supabase = serviceClient();
  const email = phase21cEmail(tag);
  const password = strongPassword();
  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user)
    throw new Error(`Failed to create ${role}: ${error?.message}`);
  const staff: Phase21CStaff = {
    authUserId: data.user.id,
    email,
    password,
    profileId: null,
    role,
  };
  tracked.staff.push(staff);

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: staff.authUserId, role }),
  );
  if (roleError) throw new Error(`Failed to assign ${role} role: ${roleError.message}`);
  const { data: row, error: profileError } = await safely<{ id: string }>(() =>
    supabase
      .from("admins")
      .insert({
        auth_user_id: staff.authUserId,
        first_name: phase21cMarker(tag),
        last_name: role === "super_admin" ? "Super" : "Admin",
        email,
        role_level: role,
      })
      .select("id")
      .single(),
  );
  if (profileError || !row)
    throw new Error(`Failed to create admin profile: ${profileError?.message}`);
  staff.profileId = row.id;
  return staff;
}

/** An active student record with an email and NO portal login yet. */
export async function createPhase21CStudent(
  tracked: Phase21CTracked,
  tag: string,
): Promise<{ id: string; email: string; studentCode: string }> {
  const supabase = serviceClient();
  const email = phase21cEmail(tag);
  const { data, error } = await safely<{ id: string; student_code: string }>(() =>
    supabase
      .from("students")
      .insert({
        first_name: phase21cMarker(tag),
        last_name: "Learner",
        email,
        phone: syntheticPhone(),
        status: "active",
      })
      .select("id, student_code")
      .single(),
  );
  if (error || !data) throw new Error(`Failed to create student: ${error?.message}`);
  tracked.studentIds.push(data.id);
  tracked.appCreatedEmails.push(email);
  return { id: data.id, email, studentCode: data.student_code };
}

/** Remembers an email whose login the running app will create. */
export function trackAppCreatedLogin(tracked: Phase21CTracked, email: string): void {
  tracked.appCreatedEmails.push(email);
}

/**
 * The one-time set-password link a provisioned person would receive, as a
 * path on this app (/auth/confirm?token_hash=…&type=recovery). Never logged.
 */
export async function activationPathFor(email: string): Promise<string> {
  const supabase = serviceClient();
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash)
    throw new Error(`Could not create an activation link: ${error?.message}`);
  return `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery&next=/reset-password`;
}

// ---------------------------------------------------------------------------
// Company settings snapshot / restore

const SETTINGS_COLUMNS =
  "company_name, legal_name, address, phone, email, website, gstin, receipt_number_format, certificate_number_format, certificate_signatory_name, certificate_signatory_title, social_links, logo_path";

export async function snapshotCompanySettings(tracked: Phase21CTracked): Promise<void> {
  const { data, error } = await serviceClient()
    .from("company_settings")
    .select(SETTINGS_COLUMNS)
    .eq("singleton", true)
    .single();
  if (error || !data)
    throw new Error(`Could not snapshot company settings: ${error?.message}`);
  tracked.settingsSnapshot = data as Record<string, unknown>;
}

export async function readCompanySettings(): Promise<Record<string, unknown>> {
  const { data, error } = await serviceClient()
    .from("company_settings")
    .select(SETTINGS_COLUMNS)
    .eq("singleton", true)
    .single();
  if (error || !data)
    throw new Error(`Could not read company settings: ${error?.message}`);
  return data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Readers

export async function readStudentLink(studentId: string): Promise<{
  authUserId: string | null;
  role: string | null;
}> {
  const supabase = serviceClient();
  const { data } = await supabase
    .from("students")
    .select("auth_user_id")
    .eq("id", studentId)
    .single();
  const authUserId =
    (data as { auth_user_id: string | null } | null)?.auth_user_id ?? null;
  if (!authUserId) return { authUserId: null, role: null };
  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return { authUserId, role: (role as { role: string } | null)?.role ?? null };
}

export async function readAdminByEmail(email: string): Promise<{
  id: string;
  roleLevel: string;
  status: string;
  role: string | null;
} | null> {
  const supabase = serviceClient();
  const { data } = await supabase
    .from("admins")
    .select("id, auth_user_id, role_level, status")
    .eq("email", email)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    id: string;
    auth_user_id: string;
    role_level: string;
    status: string;
  };
  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("auth_user_id", row.auth_user_id)
    .maybeSingle();
  return {
    id: row.id,
    roleLevel: row.role_level,
    status: row.status,
    role: (role as { role: string } | null)?.role ?? null,
  };
}

export async function readAuditActions(
  entityId: string,
): Promise<Array<{ action: string; actor_role: string | null }>> {
  const { data } = await serviceClient()
    .from("audit_logs")
    .select("action, actor_role")
    .eq("entity_id", entityId)
    .order("created_at", { ascending: true });
  return (data as Array<{ action: string; actor_role: string | null }> | null) ?? [];
}

// ---------------------------------------------------------------------------
// Cleanup

async function authUserIdForEmail(email: string): Promise<string | null> {
  const { data } = await serviceClient().rpc("find_auth_account", { p_email: email });
  const row = (data as Array<{ auth_user_id: string }> | null)?.[0];
  return row?.auth_user_id ?? null;
}

export async function cleanupPhase21C(tracked: Phase21CTracked): Promise<string[]> {
  const supabase = serviceClient();
  const failures: string[] = [];
  const push = (label: string, error: { message: string } | null) => {
    if (error) failures.push(`${label}: ${error.message}`);
  };

  if (tracked.settingsSnapshot) {
    const { error } = await safely(() =>
      supabase
        .from("company_settings")
        .update(tracked.settingsSnapshot!)
        .eq("singleton", true),
    );
    push("restore company_settings", error);
  }

  // Fixture students first. Deleting a login a student row still links
  // would make Postgres set students.auth_user_id to null, which the
  // Phase 10 students trigger (prevent_student_self_edit_of_protected_fields)
  // rightly refuses outside a service-role/admin request — Auth's own
  // database connection is neither — so deleteUser fails with "Database
  // error deleting user". Removing the student removes the link instead.
  for (const id of tracked.studentIds) {
    const { error } = await safely(() => supabase.from("students").delete().eq("id", id));
    push(`student ${id}`, error);
  }

  // Logins the app created: admins profile (FK restrict) first, then the
  // login itself (user_roles cascades).
  for (const email of tracked.appCreatedEmails) {
    const authUserId = await authUserIdForEmail(email);
    if (!authUserId) continue;
    const { error: adminError } = await safely(() =>
      supabase.from("admins").delete().eq("auth_user_id", authUserId),
    );
    push(`admins for ${email}`, adminError);
    const { error } = await safely<unknown>(() =>
      supabase.auth.admin.deleteUser(authUserId),
    );
    push(`auth user for ${email}`, error);
  }

  for (const staff of tracked.staff) {
    if (staff.profileId) {
      const { error } = await safely(() =>
        supabase.from("admins").delete().eq("id", staff.profileId!),
      );
      push(`admins ${staff.profileId}`, error);
    }
    const { error } = await safely<unknown>(() =>
      supabase.auth.admin.deleteUser(staff.authUserId),
    );
    push(`auth user ${staff.authUserId}`, error);
  }
  return failures;
}
