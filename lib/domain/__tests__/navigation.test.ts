import { describe, expect, it } from "vitest";
import { ADMIN_NAV_ITEMS, getActiveNavItem } from "@/lib/domain/navigation";

describe("ADMIN_NAV_ITEMS", () => {
  it("includes exactly the 14 required admin nav sections", () => {
    const labels = ADMIN_NAV_ITEMS.map((i) => i.label);
    expect(labels).toEqual([
      "Dashboard",
      "Students",
      "Trainers",
      "Programs",
      "Batches",
      "Enrollments",
      "Payments",
      "Attendance",
      "Materials",
      "Assignments",
      "Certificates",
      "Leads",
      "Reports",
      "Settings",
    ]);
  });

  it("has no duplicate hrefs", () => {
    const hrefs = ADMIN_NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("Dashboard and Students are marked implemented as of Phase 5", () => {
    const implemented = ADMIN_NAV_ITEMS.filter((i) => i.implemented).map((i) => i.label);
    expect(implemented).toEqual(["Dashboard", "Students"]);
  });
});

describe("getActiveNavItem", () => {
  it("matches the dashboard root exactly", () => {
    expect(getActiveNavItem("/admin")?.label).toBe("Dashboard");
  });

  it("matches a top-level module route", () => {
    expect(getActiveNavItem("/admin/students")?.label).toBe("Students");
  });

  it("matches a nested route under a module by longest-prefix", () => {
    expect(getActiveNavItem("/admin/students/123")?.label).toBe("Students");
  });

  it("does not match /admin as a prefix of every route", () => {
    // /admin/students must resolve to Students, not Dashboard, even though
    // "/admin" is technically a prefix of "/admin/students".
    expect(getActiveNavItem("/admin/students")?.label).not.toBe("Dashboard");
  });

  it("returns undefined for an unrelated path", () => {
    expect(getActiveNavItem("/login")).toBeUndefined();
  });
});
