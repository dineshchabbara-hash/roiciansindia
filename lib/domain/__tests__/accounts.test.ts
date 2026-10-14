import { describe, expect, it } from "vitest";
import { canAdoptLogin, normalizeEmail, portalAccessState } from "@/lib/domain/accounts";

const leftover = {
  authUserId: "u1",
  hasPassword: false,
  role: null,
  studentId: null,
  trainerId: null,
  adminId: null,
};

describe("canAdoptLogin", () => {
  it("adopts only a leftover login: no role, no link, no password", () => {
    expect(canAdoptLogin(leftover)).toBe(true);
  });
  it.each([
    ["has a password", { hasPassword: true }],
    ["has a role", { role: "student" }],
    ["is linked to a student", { studentId: "s1" }],
    ["is linked to a trainer", { trainerId: "t1" }],
    ["is linked to an admin", { adminId: "a1" }],
  ])("never adopts a login that %s", (_label, change) => {
    expect(canAdoptLogin({ ...leftover, ...change })).toBe(false);
  });
});

describe("portalAccessState", () => {
  it("is none when no login is linked", () => {
    expect(portalAccessState(false, "a@b.c", null)).toEqual({ status: "none" });
  });
  it("awaits activation until a password is set or a sign-in happens", () => {
    expect(
      portalAccessState(true, "a@b.c", { hasPassword: false, lastSignInAt: null }),
    ).toEqual({ status: "awaiting_activation", email: "a@b.c" });
  });
  it("is active once the person has set a password", () => {
    expect(
      portalAccessState(true, "a@b.c", {
        hasPassword: true,
        lastSignInAt: "2026-10-13T10:00:00Z",
      }),
    ).toEqual({ status: "active", email: "a@b.c", lastSignInAt: "2026-10-13T10:00:00Z" });
  });
});

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Asha.Rao@Example.COM ")).toBe("asha.rao@example.com");
  });
});
