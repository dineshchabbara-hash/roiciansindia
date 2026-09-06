import { describe, expect, it } from "vitest";
import {
  canAccessRouteGroup,
  isAdminOrSuperAdmin,
  isRole,
  isSuperAdmin,
  roleHomePath,
  ROLES,
} from "@/lib/domain/rbac";

describe("isRole", () => {
  it("accepts every known role", () => {
    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
    }
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isRole("owner")).toBe(false);
    expect(isRole("")).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});

describe("roleHomePath", () => {
  it("sends super_admin and admin to /admin", () => {
    expect(roleHomePath("super_admin")).toBe("/admin");
    expect(roleHomePath("admin")).toBe("/admin");
  });

  it("sends trainer to /trainer", () => {
    expect(roleHomePath("trainer")).toBe("/trainer");
  });

  it("sends student to /student", () => {
    expect(roleHomePath("student")).toBe("/student");
  });
});

describe("canAccessRouteGroup", () => {
  it("admin group: only admin and super_admin", () => {
    expect(canAccessRouteGroup("super_admin", "admin")).toBe(true);
    expect(canAccessRouteGroup("admin", "admin")).toBe(true);
    expect(canAccessRouteGroup("trainer", "admin")).toBe(false);
    expect(canAccessRouteGroup("student", "admin")).toBe(false);
  });

  it("trainer group: only trainer", () => {
    expect(canAccessRouteGroup("trainer", "trainer")).toBe(true);
    expect(canAccessRouteGroup("admin", "trainer")).toBe(false);
    expect(canAccessRouteGroup("super_admin", "trainer")).toBe(false);
    expect(canAccessRouteGroup("student", "trainer")).toBe(false);
  });

  it("student group: only student", () => {
    expect(canAccessRouteGroup("student", "student")).toBe(true);
    expect(canAccessRouteGroup("admin", "student")).toBe(false);
    expect(canAccessRouteGroup("super_admin", "student")).toBe(false);
    expect(canAccessRouteGroup("trainer", "student")).toBe(false);
  });

  it("a student can never reach the admin or trainer route groups by any role check", () => {
    // Directly encodes the "prevent cross-role access via URL" requirement
    // at the unit level, independent of the layout/redirect wiring.
    expect(canAccessRouteGroup("student", "admin")).toBe(false);
    expect(canAccessRouteGroup("student", "trainer")).toBe(false);
  });
});

describe("isAdminOrSuperAdmin / isSuperAdmin", () => {
  it("isAdminOrSuperAdmin is true only for admin and super_admin", () => {
    expect(isAdminOrSuperAdmin("admin")).toBe(true);
    expect(isAdminOrSuperAdmin("super_admin")).toBe(true);
    expect(isAdminOrSuperAdmin("trainer")).toBe(false);
    expect(isAdminOrSuperAdmin("student")).toBe(false);
    expect(isAdminOrSuperAdmin(null)).toBe(false);
    expect(isAdminOrSuperAdmin(undefined)).toBe(false);
  });

  it("isSuperAdmin is true only for super_admin", () => {
    expect(isSuperAdmin("super_admin")).toBe(true);
    expect(isSuperAdmin("admin")).toBe(false);
    expect(isSuperAdmin("trainer")).toBe(false);
    expect(isSuperAdmin("student")).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
  });
});
