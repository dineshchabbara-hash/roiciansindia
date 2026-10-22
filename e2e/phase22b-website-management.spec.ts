import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  RUN_ID,
  createAccount,
  isIsolatedLocalSupabase,
  readWebsiteAuditActions,
  readWebsiteDocument,
  type TestAccount,
} from "./support/phase22b-fixtures";

/**
 * Phase 22B-1 Website Management acceptance (PHASE_22B1_SECURITY_AND_TESTING_GATES.md §D).
 *
 * ISOLATED ONLY: skips unless PHASE22B_E2E_ISOLATED=1 and the app points at a
 * local, disposable Supabase stack (see e2e/support/phase22b-fixtures.ts).
 * Never run against DEV or production: website revisions and audit rows are
 * permanent by design.
 *
 *   1. Role denial: anonymous, Student, Trainer and inactive Admin cannot reach
 *      the dashboard, editor or preview by direct URL.
 *   2. Admin creates, saves, previews (private headers) and publishes a page.
 *   3. Two editors: the second save is refused as stale, the text is kept, and
 *      it can then be saved deliberately; restore creates a new draft.
 *   4. Unpublish.
 *   5. Legal page: drafted, but Publish is disabled and nothing is published.
 *   6. An anonymous request for a preview gets no draft content.
 */

test.describe.configure({ mode: "serial" });

test.skip(
  !isIsolatedLocalSupabase(),
  "Phase 22B E2E runs only against a local, disposable Supabase stack (PHASE22B_E2E_ISOLATED=1 and a 127.0.0.1/localhost URL).",
);

const ABOUT_TITLE = `About ROICIANS ${RUN_ID}`;
const LEGAL_KEY = `e2e-terms-${RUN_ID}`;

let superAdmin: TestAccount;
let admin: TestAccount;
let inactiveAdmin: TestAccount;
let trainer: TestAccount;
let student: TestAccount;
let aboutUrl = "";

async function signIn(page: Page, path: string, account: TestAccount) {
  await page.goto(path);
  await page.locator("#email").fill(account.email);
  await page.locator("#password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function adminPage(browser: Browser, account: TestAccount): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, "/login/admin", account);
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/admin$/);
  return page;
}

async function openAboutEditor(page: Page) {
  await page.goto("/admin/website");
  const create = page.getByRole("button", { name: "Create About" });
  if (await create.isVisible()) {
    await create.click();
  } else {
    await page.getByRole("link", { name: "Edit About" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();
  aboutUrl = new URL(page.url()).pathname;
}

test.beforeAll(async () => {
  superAdmin = await createAccount("super", "super_admin");
  admin = await createAccount("admin", "admin");
  inactiveAdmin = await createAccount("inactive", "admin", { inactive: true });
  trainer = await createAccount("trainer", "trainer");
  student = await createAccount("student", "student");
});

test("Admins see the Website area; other roles are refused by direct URL", async ({
  browser,
}) => {
  const page = await adminPage(browser, admin);
  await expect(
    page
      .getByRole("navigation", { name: "Admin navigation" })
      .getByRole("link", { name: "Website" }),
  ).toBeVisible();
  await page.goto("/admin/website");
  await expect(page.getByRole("heading", { level: 1, name: "Website" })).toBeVisible();

  const anonymous = await (await browser.newContext()).newPage();
  await anonymous.goto("/admin/website");
  await expect(anonymous).toHaveURL(/\/login\/admin/);

  for (const [account, path, home] of [
    [student, "/login/student", /^https?:\/\/[^/]+\/student$/],
    [trainer, "/login/trainer", /^https?:\/\/[^/]+\/trainer$/],
  ] as const) {
    const p = await (await browser.newContext()).newPage();
    await signIn(p, path, account);
    await expect(p).toHaveURL(home);
    await p.goto("/admin/website");
    await expect(p).toHaveURL(home);
  }

  const blocked = await (await browser.newContext()).newPage();
  await signIn(blocked, "/login/admin", inactiveAdmin);
  await blocked.goto("/admin/website");
  await expect(blocked).not.toHaveURL(/\/admin\/website/);
});

test("an Admin creates, saves, privately previews and publishes a page", async ({
  browser,
}) => {
  const page = await adminPage(browser, admin);
  await openAboutEditor(page);

  await page.locator("#page-title").fill(ABOUT_TITLE);
  await page.getByLabel("Add a section").selectOption("text");
  await page.getByRole("button", { name: "Add section" }).click();
  await page
    .getByLabel("Text", { exact: true })
    .fill("Practical technology training for the AI era.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Draft saved as version" }),
  ).toBeVisible();

  const previewPath = `${aboutUrl}/preview`;
  const response = await page.request.get(previewPath);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-robots-tag"]).toContain("noindex");
  const html = await response.text();
  expect(html).toContain("Preview: not public");
  expect(html).toMatch(/<meta name="robots" content="noindex/);

  await page.getByRole("button", { name: "Publish…" }).click();
  await page.getByRole("button", { name: "Confirm publish" }).click();
  await expect(page.getByText("now the live content")).toBeVisible();

  const doc = await readWebsiteDocument("about");
  expect(doc?.publishedRevisionId).toBe(doc?.latestRevisionId);
  const actions = await readWebsiteAuditActions(doc!.id);
  expect(actions).toEqual(
    expect.arrayContaining([
      "website_document.created",
      "website_document.draft_saved",
      "website_document.published",
    ]),
  );
});

test("a stale save keeps the user's text; restore creates a new draft", async ({
  browser,
}) => {
  const first = await adminPage(browser, admin);
  const second = await adminPage(browser, superAdmin);
  await first.goto(aboutUrl);
  await second.goto(aboutUrl);

  await first.locator("#page-title").fill(`${ABOUT_TITLE} (first editor)`);
  await first.getByRole("button", { name: "Save draft" }).click();
  await expect(
    first.getByRole("status").filter({ hasText: "Draft saved" }),
  ).toBeVisible();

  const mine = `${ABOUT_TITLE} (second editor)`;
  await second.locator("#page-title").fill(mine);
  await second.getByRole("button", { name: "Save draft" }).click();
  await expect(second.getByText("Someone else changed this content")).toBeVisible();
  await expect(second.locator("#page-title")).toHaveValue(mine);

  await second.getByRole("button", { name: "Save my version anyway…" }).click();
  await second.getByRole("button", { name: "Confirm: save my version" }).click();
  await expect(
    second.getByRole("status").filter({ hasText: "Draft saved" }),
  ).toBeVisible();

  await second.goto(`${aboutUrl}/history`);
  await expect(
    second.getByRole("row", { name: /Version 1/ }).getByText("Live"),
  ).toBeVisible();
  await second.getByRole("button", { name: "Restore version 1" }).click();
  await second.getByRole("button", { name: "Confirm restore" }).click();
  await expect(second.getByText(/restored as new draft version/)).toBeVisible();
  await expect(second.getByText("Published, with unpublished changes")).toBeVisible();
});

test("an Admin unpublishes the page", async ({ browser }) => {
  const page = await adminPage(browser, admin);
  await page.goto(aboutUrl);
  await page.getByRole("button", { name: "Unpublish…" }).click();
  await page.getByRole("button", { name: "Confirm unpublish" }).click();
  await expect(page.getByText(/^Unpublished\./)).toBeVisible();
  expect((await readWebsiteDocument("about"))?.publishedRevisionId).toBeNull();
});

test("a legal page can be drafted but not published", async ({ browser }) => {
  const page = await adminPage(browser, superAdmin);
  await page.goto("/admin/website");
  await page.getByLabel("New legal page key").fill(LEGAL_KEY);
  await page.getByRole("button", { name: "Create legal page" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Legal page: ${LEGAL_KEY}` }),
  ).toBeVisible();
  await page.locator("#page-title").fill("Terms of use (draft wording)");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Publish…" })).toBeDisabled();
  await expect(
    page.getByText(
      /cannot be published until their wording has business and legal approval/,
    ),
  ).toBeVisible();
  expect((await readWebsiteDocument(LEGAL_KEY))?.publishedRevisionId).toBeNull();
});

test("an anonymous preview request gets no draft content", async ({
  playwright,
  baseURL,
}) => {
  const request = await playwright.request.newContext({ baseURL, maxRedirects: 0 });
  const response = await request.get(`${aboutUrl}/preview`);
  expect([303, 307, 308]).toContain(response.status());
  expect(response.headers()["location"]).toContain("/login/admin");
  expect(await response.text()).not.toContain(ABOUT_TITLE);
  await request.dispose();
});
