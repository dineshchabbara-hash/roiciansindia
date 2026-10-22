import {
  test,
  expect,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Dialog,
  type Page,
} from "@playwright/test";
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
 * permanent by design. The isolated workflow fails if these tests are skipped.
 *
 *   1. An Admin creates a page and saves a draft (status shown at once).
 *   2. Anonymous, Student, Trainer and inactive Admin are refused the
 *      dashboard, editor, history and preview by direct URL, and see no draft.
 *   3. Every Website route sends private, no-store, noindex headers; the
 *      preview is labelled not public; an anonymous preview request is denied.
 *   4. Publish: the status changes at once, without reloading.
 *   5. Stale edit: the second save is refused, the text is kept, and it can
 *      be saved deliberately. Unsaved text is protected from in-app links and
 *      Back, and can be restored after leaving anyway.
 *   6. Version history and restore (restore creates a new draft).
 *   7. Unpublish: the status changes at once, without reloading.
 *   8. Legal page: drafted, but publishing is refused and nothing goes live;
 *      its unsaved wording is never kept in the browser tab. A confirmed
 *      Sign out clears an ordinary page's unsaved-draft copy.
 */

test.describe.configure({ mode: "serial" });

test.skip(
  !isIsolatedLocalSupabase(),
  "Phase 22B E2E runs only against a local, disposable Supabase stack (PHASE22B_E2E_ISOLATED=1 and a 127.0.0.1/localhost URL).",
);

const ABOUT_TITLE = `About ROICIANS ${RUN_ID}`;
// Appears only in saved draft content: any page that shows it leaked a draft.
const DRAFT_MARKER = `draft-only-text-${RUN_ID}`;
const LEGAL_KEY = `e2e-terms-${RUN_ID}`;
const ADMIN_HOME = /^https?:\/\/[^/]+\/admin$/;
const UNSAVED_PROMPT =
  "You have unsaved changes on this page. Leave without saving them?";

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

// Each Admin signs in once and later tests reuse the session, staying well
// inside the login rate limit (5 attempts per email per 15 minutes).
const sessions = new Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>();

async function adminPage(browser: Browser, account: TestAccount): Promise<Page> {
  const saved = sessions.get(account.email);
  if (saved) {
    const page = await (await browser.newContext({ storageState: saved })).newPage();
    await page.goto("/admin");
    await expect(page).toHaveURL(ADMIN_HOME);
    return page;
  }
  const page = await (await browser.newContext()).newPage();
  await signIn(page, "/login/admin", account);
  await expect(page).toHaveURL(ADMIN_HOME);
  sessions.set(account.email, await page.context().storageState());
  return page;
}

function publicationPanel(page: Page) {
  return page.locator('[aria-labelledby="publication-heading"]');
}

async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).first().click();
  await expect(
    page.getByRole("status").filter({ hasText: "Draft saved as version" }),
  ).toBeVisible();
}

/** Answers the editor's leave-page question; returns the questions asked. */
function answerLeavePrompts(page: Page) {
  const asked: string[] = [];
  let leave = false;
  const handler = async (dialog: Dialog) => {
    if (dialog.type() === "beforeunload") return dialog.accept();
    asked.push(dialog.message());
    await (leave ? dialog.accept() : dialog.dismiss());
  };
  page.on("dialog", handler);
  return {
    asked,
    setLeave(value: boolean) {
      leave = value;
    },
  };
}

/** The editor's unsaved-draft recovery copies currently in this tab. */
function recoveryCopyKeys(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(window.sessionStorage).filter((key) =>
      key.startsWith("roicians.website.unsaved."),
    ),
  );
}

function expectPrivateHeaders(response: APIResponse) {
  const cacheControl = response.headers()["cache-control"] ?? "";
  expect(cacheControl).toContain("private");
  expect(cacheControl).toContain("no-store");
  expect(response.headers()["x-robots-tag"]).toContain("noindex");
}

test.beforeAll(async () => {
  superAdmin = await createAccount("super", "super_admin");
  admin = await createAccount("admin", "admin");
  inactiveAdmin = await createAccount("inactive", "admin", { inactive: true });
  trainer = await createAccount("trainer", "trainer");
  student = await createAccount("student", "student");
});

test("1. an Admin creates a page and saves a draft", async ({ browser }) => {
  const page = await adminPage(browser, admin);
  await expect(
    page
      .getByRole("navigation", { name: "Admin navigation" })
      .getByRole("link", { name: "Website" }),
  ).toBeVisible();

  await page.goto("/admin/website");
  await expect(page.getByRole("heading", { level: 1, name: "Website" })).toBeVisible();
  await page.getByRole("button", { name: "Create About" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();
  aboutUrl = new URL(page.url()).pathname;
  await expect(publicationPanel(page).getByText("Created, nothing saved")).toBeVisible();

  await page.locator("#page-title").fill(ABOUT_TITLE);
  await page.locator("#page-summary").fill(DRAFT_MARKER);
  await page.getByLabel("Add a section").selectOption("text");
  await page.getByRole("button", { name: "Add section" }).click();
  await page
    .getByLabel("Text", { exact: true })
    .fill("Practical technology training for the AI era.");
  await saveDraft(page);
  await expect(publicationPanel(page).getByText("Draft", { exact: true })).toBeVisible();

  const doc = await readWebsiteDocument("about");
  expect(doc?.latestRevisionNumber).toBe(1);
  expect(doc?.publishedRevisionId).toBeNull();
  expect(await readWebsiteAuditActions(doc!.id)).toEqual([
    "website_document.created",
    "website_document.draft_saved",
  ]);

  await page.goto("/admin/website");
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "Edit About" }) });
  await expect(row.getByText("Draft", { exact: true })).toBeVisible();
});

test("2. forbidden roles cannot open the dashboard, editor, history or preview", async ({
  browser,
  playwright,
  baseURL,
}) => {
  const routes = [
    "/admin/website",
    aboutUrl,
    `${aboutUrl}/history`,
    `${aboutUrl}/preview`,
  ];

  // Anonymous: the server answers with a redirect to the Admin login and
  // never sends draft content.
  const anonymousRequest = await playwright.request.newContext({
    baseURL,
    maxRedirects: 0,
  });
  for (const route of routes) {
    const response = await anonymousRequest.get(route);
    expect([303, 307, 308], route).toContain(response.status());
    expect(response.headers()["location"], route).toContain("/login/admin");
    const body = await response.text();
    expect(body, route).not.toContain(DRAFT_MARKER);
    expect(body, route).not.toContain(ABOUT_TITLE);
  }
  await anonymousRequest.dispose();

  const anonymous = await (await browser.newContext()).newPage();
  for (const route of routes) {
    await anonymous.goto(route);
    await expect(anonymous, route).toHaveURL(/\/login\/admin/);
    await expect(anonymous.locator("body"), route).not.toContainText(DRAFT_MARKER);
  }

  const signedIn: Array<[TestAccount, string, RegExp]> = [
    [student, "/login/student", /^https?:\/\/[^/]+\/student$/],
    [trainer, "/login/trainer", /^https?:\/\/[^/]+\/trainer$/],
  ];
  for (const [account, loginPath, home] of signedIn) {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, loginPath, account);
    await expect(page).toHaveURL(home);
    for (const route of routes) {
      await page.goto(route);
      await expect(page, `${account.role} ${route}`).toHaveURL(home);
      await expect(page.locator("body")).not.toContainText(DRAFT_MARKER);
      await expect(page.locator("body")).not.toContainText(ABOUT_TITLE);
    }
  }

  // An inactive Admin is treated as signed out (Phase 21C).
  const inactive = await (await browser.newContext()).newPage();
  await signIn(inactive, "/login/admin", inactiveAdmin);
  await inactive.waitForLoadState("networkidle");
  for (const route of routes) {
    await inactive.goto(route);
    await expect(inactive, `inactive admin ${route}`).not.toHaveURL(/\/admin\/website/);
    await expect(inactive.locator("body")).not.toContainText(DRAFT_MARKER);
    await expect(inactive.locator("body")).not.toContainText(ABOUT_TITLE);
  }
});

test("3. Website routes are private and the preview is not public", async ({
  browser,
  playwright,
  baseURL,
}) => {
  const page = await adminPage(browser, admin);
  for (const route of ["/admin/website", aboutUrl, `${aboutUrl}/history`]) {
    const response = await page.request.get(route);
    expect(response.status(), route).toBe(200);
    expectPrivateHeaders(response);
  }

  const preview = await page.request.get(`${aboutUrl}/preview`);
  expect(preview.status()).toBe(200);
  expectPrivateHeaders(preview);
  const html = await preview.text();
  expect(html).toMatch(/<meta name="robots" content="noindex/);
  expect(html).toContain("Preview: not public");
  expect(html).toContain(DRAFT_MARKER);

  await page.goto(`${aboutUrl}/preview`);
  await expect(page.getByText(/^Preview: not public\./)).toBeVisible();
  await expect(page.getByRole("heading", { name: ABOUT_TITLE })).toBeVisible();

  const anonymous = await playwright.request.newContext({ baseURL, maxRedirects: 0 });
  const denied = await anonymous.get(`${aboutUrl}/preview`);
  expect([303, 307, 308]).toContain(denied.status());
  expect(denied.headers()["location"]).toContain("/login/admin");
  expect(await denied.text()).not.toContain(DRAFT_MARKER);
  await anonymous.dispose();
});

test("4. publishing updates the status at once", async ({ browser }) => {
  const page = await adminPage(browser, admin);
  await page.goto(aboutUrl);
  const panel = publicationPanel(page);
  await expect(panel.getByText("No version is live.")).toBeVisible();

  await page.getByRole("button", { name: "Publish…", exact: true }).click();
  await page.getByRole("button", { name: "Confirm publish" }).click();
  await expect(page.getByText("now the live content")).toBeVisible();
  // No reload: the panel reflects the new state straight away.
  await expect(panel.getByText("Published", { exact: true })).toBeVisible();
  await expect(panel.getByText("Live version: 1.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish…", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Unpublish…" })).toBeVisible();

  const doc = await readWebsiteDocument("about");
  expect(doc?.publishedRevisionId).toBe(doc?.latestRevisionId);
  expect(await readWebsiteAuditActions(doc!.id)).toContain("website_document.published");
});

test("5. a stale save keeps the user's text, and unsaved text is protected", async ({
  browser,
}) => {
  const first = await adminPage(browser, admin);
  const second = await adminPage(browser, superAdmin);
  const prompts = answerLeavePrompts(second);

  await first.goto(aboutUrl);
  // Open the editor through the dashboard so Back stays inside the app.
  await second.goto("/admin/website");
  await second.getByRole("link", { name: "Edit About" }).click();
  await expect(second).toHaveURL(new RegExp(`${aboutUrl}$`));

  await first.locator("#page-title").fill(`${ABOUT_TITLE} (first editor)`);
  await saveDraft(first);

  const mine = `${ABOUT_TITLE} (second editor)`;
  await second.locator("#page-title").fill(mine);

  // In-app links and Back ask first; staying keeps the text.
  await second
    .getByRole("navigation", { name: "Admin navigation" })
    .getByRole("link", { name: "Students" })
    .click();
  await second.getByRole("link", { name: "Version history" }).click();
  await second.goBack({ waitUntil: "commit", timeout: 3_000 }).catch(() => null);
  await expect.poll(() => prompts.asked.length).toBe(3);
  expect(new Set(prompts.asked)).toEqual(new Set([UNSAVED_PROMPT]));
  await expect(second).toHaveURL(new RegExp(`${aboutUrl}$`));
  await expect(second.locator("#page-title")).toHaveValue(mine);

  // The database refuses the stale save; the text stays on screen.
  await second.getByRole("button", { name: "Save draft" }).first().click();
  await expect(second.getByText("Someone else changed this content")).toBeVisible();
  await expect(second.locator("#page-title")).toHaveValue(mine);
  expect((await readWebsiteDocument("about"))?.latestRevisionNumber).toBe(2);

  await second.getByRole("button", { name: "Save my version anyway…" }).click();
  await second.getByRole("button", { name: "Confirm: save my version" }).click();
  await expect(
    second.getByRole("status").filter({ hasText: "Draft saved as version 3" }),
  ).toBeVisible();

  // Leaving anyway: the text can be restored from this tab afterwards.
  const left = "Text typed and then left behind";
  await second.locator("#page-title").fill(left);
  await second.waitForTimeout(800);
  prompts.setLeave(true);
  await second
    .getByRole("navigation", { name: "Admin navigation" })
    .getByRole("link", { name: "Website" })
    .click();
  await expect(second).toHaveURL(/\/admin\/website$/);
  prompts.setLeave(false);
  await second.getByRole("link", { name: "Edit About" }).click();
  await expect(
    second
      .getByRole("alert")
      .filter({ hasText: "Unsaved changes to this page were found" }),
  ).toBeVisible();
  await expect(second.locator("#page-title")).toHaveValue(mine);
  await second.getByRole("button", { name: "Restore unsaved changes" }).click();
  await expect(second.locator("#page-title")).toHaveValue(left);
  // Nothing was saved by restoring.
  expect((await readWebsiteDocument("about"))?.latestRevisionNumber).toBe(3);
});

test("6. version history lists every version and restore creates a new draft", async ({
  browser,
}) => {
  const page = await adminPage(browser, superAdmin);
  await page.goto(aboutUrl);
  await page.getByRole("link", { name: "Version history" }).click();
  await expect(page).toHaveURL(new RegExp(`${aboutUrl}/history$`));

  for (const n of [1, 2, 3]) {
    await expect(
      page.getByRole("rowheader", { name: new RegExp(`Version ${n}\\b`) }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("row", { name: /Version 1\b/ }).getByText("Live"),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Version 3\b/ }).getByText("Latest draft"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore version 3" })).toHaveCount(0);

  await page.getByRole("button", { name: "Restore version 1" }).click();
  await page.getByRole("button", { name: "Confirm restore" }).click();
  await expect(page.getByText(/restored as new draft version 4/)).toBeVisible();
  await expect(page.locator("#page-title")).toHaveValue(ABOUT_TITLE);
  await expect(
    publicationPanel(page).getByText("Published, with unpublished changes"),
  ).toBeVisible();

  const doc = await readWebsiteDocument("about");
  expect(doc?.latestRevisionNumber).toBe(4);
  expect(doc?.publishedRevisionId).not.toBe(doc?.latestRevisionId);
  expect(await readWebsiteAuditActions(doc!.id)).toContain(
    "website_document.revision_restored",
  );

  await page.goto(`${aboutUrl}/history`);
  await expect(
    page.getByRole("row", { name: /Version 4\b/ }).getByText("Restored from version 1"),
  ).toBeVisible();
});

test("7. unpublishing updates the status at once", async ({ browser }) => {
  const page = await adminPage(browser, admin);
  await page.goto(aboutUrl);
  const panel = publicationPanel(page);
  await page.getByRole("button", { name: "Unpublish…" }).click();
  await page.getByRole("button", { name: "Confirm unpublish" }).click();
  await expect(page.getByText(/^Unpublished\./)).toBeVisible();
  await expect(panel.getByText("Unpublished", { exact: true })).toBeVisible();
  await expect(panel.getByText("No version is live.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unpublish…" })).toHaveCount(0);

  const doc = await readWebsiteDocument("about");
  expect(doc?.publishedRevisionId).toBeNull();
  expect(await readWebsiteAuditActions(doc!.id)).toContain(
    "website_document.unpublished",
  );

  await page.goto("/admin/website");
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "Edit About" }) });
  await expect(row.getByText("Unpublished", { exact: true })).toBeVisible();
});

test("8. a legal page can be drafted but not published", async ({ browser }) => {
  const page = await adminPage(browser, superAdmin);
  const prompts = answerLeavePrompts(page);
  await page.goto("/admin/website");
  await page.getByLabel("New legal page key").fill(LEGAL_KEY);
  await page.getByRole("button", { name: "Create legal page" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Legal page: ${LEGAL_KEY}` }),
  ).toBeVisible();
  await page.locator("#page-title").fill("Terms of use (draft wording)");
  await saveDraft(page);

  // Refused for a Super Admin too: the button stays disabled with the reason.
  await expect(
    page.getByRole("button", { name: "Publish…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      /cannot be published until their wording has business and legal approval/,
    ),
  ).toBeVisible();

  const doc = await readWebsiteDocument(LEGAL_KEY);
  expect(doc?.publishedRevisionId).toBeNull();
  const actions = await readWebsiteAuditActions(doc!.id);
  expect(actions).toContain("website_document.draft_saved");
  expect(actions).not.toContain("website_document.published");

  // Unsaved legal wording is never kept in the browser tab.
  await page.locator("#page-title").fill("Unapproved legal wording (unsaved)");
  await page.waitForTimeout(800);
  expect(await recoveryCopyKeys(page)).toEqual([]);

  prompts.setLeave(true);
  await page.goto("/admin/website");
  await expect(
    page.getByText("Publishing held: wording not yet approved").first(),
  ).toBeVisible();

  // An ordinary page's unsaved text is kept in the tab until Sign out, which
  // clears it once confirmed. (Last test: signing out ends this session.)
  await page.getByRole("link", { name: "Edit About" }).click();
  await page.locator("#page-title").fill("About text left unsaved at sign-out");
  await page.waitForTimeout(800);
  expect(await recoveryCopyKeys(page)).toHaveLength(1);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/admin"));
  expect(prompts.asked).toContain(UNSAVED_PROMPT);
  expect(await recoveryCopyKeys(page)).toEqual([]);
});
