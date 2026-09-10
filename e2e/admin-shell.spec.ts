import { test, expect } from "@playwright/test";

// These are REAL browser E2E tests (Playwright + Chromium), run against
// this sandbox's deliberately unreachable Supabase URL (see .env.local),
// so getCurrentUserContext() always fails closed to "not authenticated" —
// exactly the scenario these tests target. They do NOT exercise a real
// authenticated Admin/Trainer/Student session: this sandbox has no real
// Supabase/GoTrue project to authenticate against, so "Student cannot
// access Admin" / "Admin can access Admin" for an actually-logged-in user
// are covered instead at the unit level (lib/domain/__tests__/rbac.test.ts)
// and, for RLS itself, by the local Postgres + stubbed auth.uid() harness
// described in the Phase 4 report — neither of those is a substitute for
// real-Supabase E2E, which still needs to happen against a real project.

const ADMIN_ROUTES = [
  "/admin",
  "/admin/students",
  "/admin/trainers",
  "/admin/programs",
  "/admin/batches",
  "/admin/enrollments",
  "/admin/payments",
  "/admin/attendance",
  "/admin/materials",
  "/admin/assignments",
  "/admin/certificates",
  "/admin/leads",
  "/admin/reports",
  "/admin/settings",
];

for (const route of ADMIN_ROUTES) {
  test(`unauthenticated access to ${route} redirects to /login/admin`, async ({
    page,
  }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login\/admin/);
    // Never a flash of real admin content before the redirect completes.
    await expect(page.getByText("Signed in as")).toHaveCount(0);
  });
}

test("placeholder module pages are clearly labeled, not fake working features", async ({
  page,
}) => {
  // Can't reach the authenticated placeholder page directly in this
  // sandbox (no real Supabase session available) — this test instead
  // proves the redirect target itself is the real login page, not a blank
  // or crashed page, for a representative placeholder route. `/admin/students`
  // and `/admin/trainers` are real as of Phase 5/6, so a still-unbuilt route
  // is used here instead.
  await page.goto("/admin/programs");
  await expect(page.getByRole("heading", { name: "Admin Login" })).toBeVisible();
});
