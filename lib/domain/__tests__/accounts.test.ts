import { describe, expect, it } from "vitest";
import { canAdoptLogin, normalizeEmail, portalAccessState } from "@/lib/domain/accounts";

const leftover = {
  authUserId: "u1",
  provisionedByLms: true,
  hasSignedIn: false,
  role: null,
  studentId: null,
  trainerId: null,
  adminId: null,
};

describe("canAdoptLogin", () => {
  it("adopts only an unused LMS-provisioned login: marker, no role, no link, never signed in", () => {
    expect(canAdoptLogin(leftover)).toBe(true);
  });
  it.each([
    ["was not created by LMS provisioning", { provisionedByLms: false }],
    ["has been signed in to", { hasSignedIn: true }],
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
  it("awaits activation until the first sign-in", () => {
    expect(portalAccessState(true, "a@b.c", { lastSignInAt: null })).toEqual({
      status: "awaiting_activation",
      email: "a@b.c",
    });
    expect(portalAccessState(true, "a@b.c", null)).toEqual({
      status: "awaiting_activation",
      email: "a@b.c",
    });
  });
  it("is active once the person has signed in", () => {
    expect(
      portalAccessState(true, "a@b.c", { lastSignInAt: "2026-10-13T10:00:00Z" }),
    ).toEqual({ status: "active", email: "a@b.c", lastSignInAt: "2026-10-13T10:00:00Z" });
  });
});

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Asha.Rao@Example.COM ")).toBe("asha.rao@example.com");
  });
});
