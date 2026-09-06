/**
 * Pure role/permission logic — no I/O, no Supabase client, fully testable
 * without a database. This is the single source of truth for "what role
 * goes where"; route-group layouts and server actions both call into this
 * module rather than re-encoding the mapping themselves.
 */

export const ROLES = ["super_admin", "admin", "trainer", "student"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** The route group a given role lands on after login. */
export function roleHomePath(role: Role): string {
  switch (role) {
    case "super_admin":
    case "admin":
      return "/admin";
    case "trainer":
      return "/trainer";
    case "student":
      return "/student";
  }
}

export type RouteGroup = "admin" | "trainer" | "student";

/**
 * Whether a role is allowed into a given portal's route group. Used by each
 * route group's layout as the server-side authorization gate — the layout
 * itself decides what to do on a "false" (redirect to /login if there's no
 * session at all, or to the caller's own home if they're logged in but hold
 * the wrong role) per USER_ROLES_AND_PERMISSIONS.md §2.
 */
export function canAccessRouteGroup(role: Role, group: RouteGroup): boolean {
  switch (group) {
    case "admin":
      return role === "admin" || role === "super_admin";
    case "trainer":
      return role === "trainer";
    case "student":
      return role === "student";
  }
}

export function isAdminOrSuperAdmin(role: Role | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

export function isSuperAdmin(role: Role | null | undefined): boolean {
  return role === "super_admin";
}
