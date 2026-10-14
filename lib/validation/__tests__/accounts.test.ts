import { describe, expect, it } from "vitest";
import {
  adminAccountSchema,
  adminStatusSchema,
  studentPortalAccessSchema,
} from "@/lib/validation/accounts";

describe("account forms", () => {
  it("normalizes the admin email and requires names", () => {
    expect(
      adminAccountSchema.parse({
        firstName: " Asha ",
        lastName: "Rao",
        email: " Asha@Example.COM ",
      }),
    ).toEqual({ firstName: "Asha", lastName: "Rao", email: "asha@example.com" });
    expect(
      adminAccountSchema.safeParse({ firstName: "", lastName: "Rao", email: "a@b.co" })
        .success,
    ).toBe(false);
    expect(
      adminAccountSchema.safeParse({ firstName: "A", lastName: "B", email: "nope" })
        .success,
    ).toBe(false);
  });

  it("never accepts a role from the form", () => {
    const parsed = adminAccountSchema.parse({
      firstName: "A",
      lastName: "B",
      email: "a@b.co",
      role: "super_admin",
    } as Record<string, string>);
    expect(parsed).not.toHaveProperty("role");
  });

  it("only accepts an id and a known status", () => {
    expect(studentPortalAccessSchema.safeParse({ studentId: "x" }).success).toBe(false);
    expect(
      adminStatusSchema.safeParse({
        adminId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
        status: "super_admin",
      }).success,
    ).toBe(false);
  });
});
