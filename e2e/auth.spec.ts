import { test, expect } from "@playwright/test";

// These tests run against an intentionally unreachable Supabase URL
// (see .env.local in this environment) — that is itself the point of most
// of them: the app must fail CLOSED (treat "can't verify" as "not
// authenticated") rather than crash or, worse, fail open.

test("home page shows the three login entry points", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Student Login" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Trainer Login" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin Login" })).toBeVisible();
});

test("student/trainer/admin login pages render distinct, correct copy", async ({
  page,
}) => {
  await page.goto("/login/student");
  await expect(page.getByRole("heading", { name: "Student Login" })).toBeVisible();

  await page.goto("/login/trainer");
  await expect(page.getByRole("heading", { name: "Trainer Login" })).toBeVisible();

  await page.goto("/login/admin");
  await expect(page.getByRole("heading", { name: "Admin Login" })).toBeVisible();
});

test("login form shows client-side validation before any submission", async ({
  page,
}) => {
  await page.goto("/login/student");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Native HTML5 "required" validation blocks submission — the email field
  // itself should still be empty/focused, not navigated away.
  await expect(page).toHaveURL(/\/login\/student/);
});

test("submitting a login form with an unreachable Supabase backend fails closed with a generic error, not a crash", async ({
  page,
}) => {
  await page.goto("/login/student");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("whatever-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Must show OUR generic error message, not a Next.js error overlay/stack
  // trace, and must not silently redirect to a portal. Filtered because
  // Next.js's own route-announcer also carries role="alert" on every page.
  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid email or password" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login\/student/);
});

test("unauthenticated direct navigation to every protected portal redirects to the matching login page, never renders portal content", async ({
  page,
}) => {
  // "Signed in as ..." only ever appears inside PortalPlaceholderShell, the
  // actual portal content — unlike "Admin/Trainer/Student Portal", which
  // also appears as a substring of each login page's own description copy,
  // so checking for that phrase here would produce a false pass.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\/admin/);
  await expect(page.getByText("Signed in as")).toHaveCount(0);

  await page.goto("/trainer");
  await expect(page).toHaveURL(/\/login\/trainer/);
  await expect(page.getByText("Signed in as")).toHaveCount(0);

  await page.goto("/student");
  await expect(page).toHaveURL(/\/login\/student/);
  await expect(page.getByText("Signed in as")).toHaveCount(0);
});

test("forgot-password always shows the same generic confirmation regardless of whether the address exists", async ({
  page,
}) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("might-not-exist@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If an account exists for that email/)).toBeVisible();
});

test("forgot-password rejects an invalid email address client-side", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Send reset link" }).click();
  // Native email input validation keeps us on the page rather than
  // submitting a malformed address.
  await expect(page).toHaveURL(/\/forgot-password/);
});
