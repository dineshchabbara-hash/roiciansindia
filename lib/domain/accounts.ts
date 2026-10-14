/**
 * Phase 21C — portal logins (Student portal access, Admin accounts). Pure.
 *
 * A profile (students / admins row) and a login (Supabase Auth user) are
 * separate things, linked only by the server. Provisioning creates a login
 * with NO password; the person sets their own through the existing
 * "Forgot / set password" flow, so no password is ever chosen by, shown to
 * or stored for an Admin. The role is fixed by the operation (student or
 * admin) — never taken from the request.
 */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** What the server knows about an existing login for an email. */
export type ExistingLogin = {
  authUserId: string;
  hasPassword: boolean;
  role: string | null;
  studentId: string | null;
  trainerId: string | null;
  adminId: string | null;
};

/**
 * Whether provisioning may adopt an existing login for this email instead
 * of creating one. Only a login that is a leftover of an earlier,
 * interrupted provisioning qualifies: no role, no profile link and no
 * password (nobody can sign in with it). Anything else belongs to someone.
 */
export function canAdoptLogin(login: ExistingLogin): boolean {
  return (
    login.role === null &&
    login.studentId === null &&
    login.trainerId === null &&
    login.adminId === null &&
    !login.hasPassword
  );
}

export type PortalAccessState =
  | { status: "none" }
  | { status: "awaiting_activation"; email: string | null }
  | { status: "active"; email: string | null; lastSignInAt: string | null };

/** Display state of a linked login. */
export function portalAccessState(
  linked: boolean,
  email: string | null,
  activity: { hasPassword: boolean; lastSignInAt: string | null } | null,
): PortalAccessState {
  if (!linked) return { status: "none" };
  if (activity && (activity.hasPassword || activity.lastSignInAt)) {
    return { status: "active", email, lastSignInAt: activity.lastSignInAt };
  }
  return { status: "awaiting_activation", email };
}

export const STUDENT_LINK_MESSAGES: Record<string, string> = {
  student_not_found: "Student not found.",
  student_inactive: "Portal access can only be given to an active student.",
  student_has_other_account:
    "This student is already linked to a different login. Contact a Super Admin.",
  account_in_use:
    "This email already belongs to another portal account (staff or another student). Give the student a unique email first.",
};

export const ADMIN_LINK_MESSAGES: Record<string, string> = {
  account_in_use:
    "This email already belongs to another portal account (student, trainer or super admin).",
  email_in_use: "An admin account with this email already exists.",
};

/** How a person activates a provisioned login (shown to the Admin). */
export const ACTIVATION_INSTRUCTIONS =
  'They activate it themselves: on the login page choose "Forgot password?", enter this email, and set their own password from the link they receive.';
