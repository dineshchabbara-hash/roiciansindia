/**
 * Phase 21C — portal logins (Student portal access, Admin accounts). Pure.
 *
 * A profile (students / admins row) and a login (Supabase Auth user) are
 * separate things, linked only by the server. Provisioning creates a login
 * without supplying a password; the person sets their own through the
 * existing "Forgot / set password" flow, so no password is ever chosen by,
 * shown to or stored for an Admin. The role is fixed by the operation
 * (student or admin) — never taken from the request.
 *
 * Supabase Auth stores a random, never-disclosed password hash for a login
 * created without one, so "has a password hash" says nothing about whether
 * the person activated it. What does: a first sign-in, which for such a
 * login is only possible through the emailed set-password link.
 */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** What the server knows about an existing login for an email. */
export type ExistingLogin = {
  authUserId: string;
  /** Created by LMS provisioning (service-role-only app_metadata marker). */
  provisionedByLms: boolean;
  hasSignedIn: boolean;
  role: string | null;
  studentId: string | null;
  trainerId: string | null;
  adminId: string | null;
};

/**
 * Whether provisioning may adopt an existing login for this email instead
 * of creating one. Only a leftover of an earlier, interrupted provisioning
 * qualifies: created by LMS provisioning, no role, no profile link and
 * never signed in (nobody has used it). Anything else belongs to someone.
 */
export function canAdoptLogin(login: ExistingLogin): boolean {
  return (
    login.provisionedByLms &&
    !login.hasSignedIn &&
    login.role === null &&
    login.studentId === null &&
    login.trainerId === null &&
    login.adminId === null
  );
}

/** The service-role-only app_metadata key marking a provisioned login. */
export const LMS_PROVISIONED_MARKER = "lms_provisioned";

export type PortalAccessState =
  | { status: "none" }
  | { status: "awaiting_activation"; email: string | null }
  | { status: "active"; email: string | null; lastSignInAt: string | null };

/**
 * Display state of a linked login: active once the person has signed in
 * (activation link or password), awaiting activation until then. The
 * stored password hash is deliberately not consulted (see file header).
 */
export function portalAccessState(
  linked: boolean,
  email: string | null,
  activity: { lastSignInAt: string | null } | null,
): PortalAccessState {
  if (!linked) return { status: "none" };
  if (activity?.lastSignInAt) {
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
