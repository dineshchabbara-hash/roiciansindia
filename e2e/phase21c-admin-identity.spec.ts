import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import {
  activationPathFor,
  cleanupPhase21C,
  createPhase21CStaff,
  createPhase21CStudent,
  hasRealSupabaseCredentials,
  newPhase21CTracked,
  phase21cEmail,
  phase21cMarker,
  readAdminByEmail,
  readAuditActions,
  readCompanySettings,
  readStudentLink,
  snapshotCompanySettings,
  strongPassword,
  trackAppCreatedLogin,
  type Phase21CStaff,
  type Phase21CTracked,
} from "./support/phase21c-fixtures";

/**
 * Phase 21C (LMS Administration & Identity) acceptance — three independent
 * tests with their own synthetic accounts. The RLS / role-escalation /
 * audit-visibility / photo-ownership matrix is proven in
 * supabase/tests/phase21c_admin_identity_test.sql and the provisioning
 * races in scripts/test-portal-provisioning-concurrency.sh, not here.
 *
 *   1. A Super Admin edits Company Settings; an Admin sees the same values
 *      read-only and has no Admin Accounts entry. The settings row is
 *      restored afterwards.
 *   2. An Admin gives an existing Student portal access; the Student
 *      activates the login by setting their own password and signs in to
 *      /student.
 *   3. A Super Admin creates an Admin account (role fixed to admin); an
 *      ordinary Admin cannot reach Admin Accounts; a deactivated Admin can
 *      no longer sign in.
 */

test.describe.configure({ mode: "serial" });

test.skip(
  !hasRealSupabaseCredentials(),
  "Phase 21C E2E requires dev Supabase credentials in .env.local.",
);

function adminNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin navigation" });
}

async function signIn(page: Page, path: string, email: string, password: string) {
  await page.goto(path);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function signInAdmin(page: Page, staff: Phase21CStaff) {
  await signIn(page, "/login/admin", staff.email, staff.password);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(adminNav(page)).toBeVisible();
}

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function cleanup(tracked: Phase21CTracked) {
  const failures = await cleanupPhase21C(tracked);
  expect(failures, `Phase 21C cleanup failures:\n${failures.join("\n")}`).toEqual([]);
}

test.describe("Company Settings: Super Admin edits, Admin reads", () => {
  const tracked = newPhase21CTracked();
  let superAdmin: Phase21CStaff;
  let admin: Phase21CStaff;

  test.beforeAll(async () => {
    await snapshotCompanySettings(tracked);
    superAdmin = await createPhase21CStaff(tracked, "SettingsSuper", "super_admin");
    admin = await createPhase21CStaff(tracked, "SettingsAdmin", "admin");
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  test("a Super Admin saves company details and an Admin sees them read-only", async ({
    page,
    browser,
  }) => {
    // Two sign-ins and four page loads against the remote dev project; the
    // comparable Phase 21B Test 1 measured well under this 60s ceiling.
    test.setTimeout(60_000);
    const address = `${phase21cMarker("Addr")} 12 MG Road, Bengaluru`;
    const signatory = phase21cMarker("Signatory");

    await signInAdmin(page, superAdmin);
    await adminNav(page).getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await expect(
      adminNav(page).getByRole("link", { name: "Admin Accounts" }),
    ).toBeVisible();
    const form = page.getByRole("form", { name: "Company settings" });
    await form.getByLabel("Address").fill(address);
    await form.getByLabel("Signatory name").fill(signatory);
    await form.getByRole("button", { name: "Save settings" }).click();
    await expect(form.getByRole("status")).toHaveText("Company settings saved.");

    const saved = await readCompanySettings();
    expect(saved.address).toBe(address);
    expect(saved.certificate_signatory_name).toBe(signatory);
    expect(saved.legal_name).toBe(tracked.settingsSnapshot!.legal_name);

    // Admin: same values, read-only, no Admin Accounts entry.
    const adminPage = await newPage(browser);
    await signInAdmin(adminPage, admin);
    await expect(
      adminNav(adminPage).getByRole("link", { name: "Admin Accounts" }),
    ).toHaveCount(0);
    await adminNav(adminPage)
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    await expect(adminPage).toHaveURL(/\/admin\/settings$/);
    const view = adminPage.locator('dl[aria-label="Company settings"]');
    await expect(view).toContainText(address);
    await expect(view).toContainText(signatory);
    await expect(adminPage.getByRole("form", { name: "Company settings" })).toHaveCount(
      0,
    );
    await expect(adminPage.getByRole("button", { name: "Save settings" })).toHaveCount(0);
    await adminPage.context().close();
  });
});

test.describe("Student portal access: Admin provisions, Student activates", () => {
  const tracked = newPhase21CTracked();
  let admin: Phase21CStaff;
  let student: { id: string; email: string; studentCode: string };

  test.beforeAll(async () => {
    admin = await createPhase21CStaff(tracked, "PortalAdmin", "admin");
    student = await createPhase21CStudent(tracked, "PortalStudent");
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  test("an Admin gives portal access and the Student signs in after setting a password", async ({
    page,
    browser,
  }) => {
    // Two sign-ins, one login provisioning (Auth admin API) and one
    // password set against the remote dev project; 60s ceiling, default
    // assertion timeouts.
    test.setTimeout(60_000);
    await signInAdmin(page, admin);
    await page.goto(`/admin/students/${student.id}`);
    const card = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole("heading", { name: "Portal access", exact: true }) });
    await expect(card.getByText("No portal access")).toBeVisible();
    await card.getByRole("button", { name: "Give portal access" }).click();
    await expect(card.getByRole("status")).toHaveText(
      `Portal access created for ${student.email}.`,
    );
    await page.reload();
    await expect(card.getByText("Awaiting activation")).toBeVisible();
    await expect(card.getByRole("button", { name: "Give portal access" })).toHaveCount(0);

    const link = await readStudentLink(student.id);
    expect(link.authUserId).not.toBeNull();
    expect(link.role).toBe("student");
    expect(
      (await readAuditActions(student.id)).map((a) => [a.action, a.actor_role]),
    ).toContainEqual(["student.portal_access_granted", "admin"]);

    // The Student activates the login by choosing their own password.
    const studentPage = await newPage(browser);
    const password = strongPassword();
    await studentPage.goto(await activationPathFor(student.email));
    await expect(studentPage).toHaveURL(/\/reset-password$/);
    await studentPage.getByLabel("New password", { exact: true }).fill(password);
    await studentPage.getByLabel("Confirm new password").fill(password);
    await studentPage.getByRole("button", { name: "Update password" }).click();
    await expect(studentPage).toHaveURL(/\/login\?passwordUpdated=1$/);

    await signIn(studentPage, "/login/student", student.email, password);
    await expect(studentPage).toHaveURL(/\/student$/);
    await expect(
      studentPage.getByRole("navigation", { name: "Student navigation" }),
    ).toBeVisible();
    await studentPage.context().close();

    // Retrying never creates a second login.
    await page.reload();
    await expect(card.getByText(/^Active/)).toBeVisible();
    expect((await readStudentLink(student.id)).authUserId).toBe(link.authUserId);
  });
});

test.describe("Admin accounts: Super Admin only, deactivation blocks sign-in", () => {
  const tracked = newPhase21CTracked();
  let superAdmin: Phase21CStaff;
  let admin: Phase21CStaff;

  test.beforeAll(async () => {
    superAdmin = await createPhase21CStaff(tracked, "AccountsSuper", "super_admin");
    admin = await createPhase21CStaff(tracked, "AccountsAdmin", "admin");
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  test("a Super Admin creates an Admin; an Admin cannot manage admins; a deactivated Admin cannot sign in", async ({
    page,
    browser,
  }) => {
    // Three sign-ins, one login creation and two status changes against
    // the remote dev project; 60s ceiling, default assertion timeouts.
    test.setTimeout(60_000);

    // An ordinary Admin has no Admin Accounts entry and is sent away.
    const adminPage = await newPage(browser);
    await signInAdmin(adminPage, admin);
    await expect(
      adminNav(adminPage).getByRole("link", { name: "Admin Accounts" }),
    ).toHaveCount(0);
    await adminPage.goto("/admin/admins");
    await expect(adminPage).toHaveURL(/\/admin$/);
    await adminPage.context().close();

    // The Super Admin creates a new Admin (role fixed to admin).
    const newEmail = phase21cEmail("CreatedAdmin");
    trackAppCreatedLogin(tracked, newEmail);
    await signInAdmin(page, superAdmin);
    await adminNav(page).getByRole("link", { name: "Admin Accounts" }).click();
    await expect(page).toHaveURL(/\/admin\/admins$/);
    const form = page.getByRole("form", { name: "Create admin account" });
    await form.getByLabel("First name").fill(phase21cMarker("Created"));
    await form.getByLabel("Last name").fill("Admin");
    await form.getByLabel("Email").fill(newEmail);
    await form.getByRole("button", { name: "Create admin account" }).click();
    await expect(form.getByRole("status")).toHaveText(
      `Admin account created for ${newEmail}.`,
    );
    const created = await readAdminByEmail(newEmail);
    expect(created).toMatchObject({
      roleLevel: "admin",
      status: "active",
      role: "admin",
    });

    const accounts = page.getByRole("table", { name: "Admin accounts" });
    const createdRow = accounts.locator("tr").filter({ hasText: newEmail });
    await expect(createdRow).toContainText("Awaiting activation");

    // Deactivate the ordinary Admin; their sign-in is then refused.
    const adminRow = accounts.locator("tr").filter({ hasText: admin.email });
    await adminRow.getByRole("button", { name: /^Deactivate/ }).click();
    await expect(adminRow).toContainText("Deactivated");
    expect((await readAdminByEmail(admin.email))?.status).toBe("inactive");

    const blockedPage = await newPage(browser);
    await signIn(blockedPage, "/login/admin", admin.email, admin.password);
    await expect(blockedPage.getByRole("alert")).toBeVisible();
    await expect(blockedPage).toHaveURL(/\/login\/admin$/);
    await blockedPage.context().close();

    // The Super Admin's own row offers no action.
    const ownRow = accounts.locator("tr").filter({ hasText: superAdmin.email });
    await expect(ownRow.getByRole("button")).toHaveCount(0);
  });
});
