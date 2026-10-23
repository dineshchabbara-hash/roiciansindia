import {
  test,
  expect,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createAccount, type TestAccount } from "./support/phase22b-fixtures";
import {
  RUN_ID,
  createBatch,
  createProgram,
  isIsolatedLocalSupabase,
  readAuditActions,
  readBatchPublication,
  readDisplayGroupState,
  readDisplayGroups,
  readMaxActiveGroupOrder,
  readProgram,
  readProgramDocument,
  type TestBatch,
  type TestProgram,
} from "./support/phase22b2-fixtures";

/**
 * Phase 22B-2 Program Website Management acceptance.
 *
 * ISOLATED ONLY: skips unless PHASE22B_E2E_ISOLATED=1 and the app points at a
 * local, disposable Supabase stack. The synthetic Programs, Batches, groups
 * and website content it creates exist only in that throwaway database.
 *
 *   1. An Admin sets up a Program's website content and saves a draft; the
 *      LMS Program record is unchanged.
 *   2. Anonymous, Student, Trainer and inactive Admin are refused every 22B-2
 *      screen by direct URL, with no draft content shown.
 *   3. Every 22B-2 route is private (no-store, noindex); the preview is not
 *      public; an anonymous preview request is denied.
 *   4. A Program not active in the LMS cannot be published; an active one
 *      publishes and its status changes at once.
 *   5. A published Program's web address is locked for Admin and Super Admin;
 *      an unpublished one can change.
 *   6. Display groups: create, rename, hide and reorder (audited); archive
 *      (confirmed; refused while the group holds a Program, which keeps its
 *      group) and restore (refused while an active group uses the name;
 *      restored last, still hidden), all audited.
 *   7. Placement and featured order, each confirmed; a stale placement save
 *      is refused.
 *   8. Batch publication: label and Open/Closed/Full, publish, change,
 *      unpublish; a completed Batch cannot be published; the preview shows
 *      the public label only.
 */

test.describe.configure({ mode: "serial" });

test.skip(
  !isIsolatedLocalSupabase(),
  "Phase 22B E2E runs only against a local, disposable Supabase stack (PHASE22B_E2E_ISOLATED=1 and a 127.0.0.1/localhost URL).",
);

const ADMIN_HOME = /^https?:\/\/[^/]+\/admin$/;
const DRAFT_MARKER = `program-draft-text-${RUN_ID}`;
const HEADLINE = `E2E Headline ${RUN_ID}`;
const GROUP_A = `E2E Group A ${RUN_ID}`;
const GROUP_A_RENAMED = `E2E Group A2 ${RUN_ID}`;
const GROUP_B = `E2E Group B ${RUN_ID}`;
const GROUP_C = `E2E Group C ${RUN_ID}`;
const GROUP_A_TWIN = `E2E Group A twin ${RUN_ID}`;
const BATCH_LABEL = `Weekend batch E2E ${RUN_ID}`;
const STALE_MESSAGE = /changed this content|changed by someone else/i;

let superAdmin: TestAccount;
let admin: TestAccount;
let inactiveAdmin: TestAccount;
let trainer: TestAccount;
let student: TestAccount;
let activeProgram: TestProgram;
let draftProgram: TestProgram;
let upcomingBatch: TestBatch;
let completedBatch: TestBatch;
let activeLmsBefore: unknown;
let activePath = "";
let draftPath = "";

const sessions = new Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>();

async function signIn(page: Page, path: string, account: TestAccount) {
  await page.goto(path);
  await page.locator("#email").fill(account.email);
  await page.locator("#password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

// Each Admin signs in once; later tests reuse the session (login rate limit).
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

function expectPrivateHeaders(response: APIResponse) {
  const cacheControl = response.headers()["cache-control"] ?? "";
  expect(cacheControl).toContain("private");
  expect(cacheControl).toContain("no-store");
  expect(response.headers()["x-robots-tag"]).toContain("noindex");
}

async function setUpWebsite(page: Page, program: TestProgram, slug: string) {
  await page.goto("/admin/website/programs");
  const form = page.getByRole("form", {
    name: `Set up website content for ${program.name}`,
  });
  await form.getByLabel("Web address").fill(slug);
  await form.getByRole("button", { name: "Set up website content" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Program: ${program.name}` }),
  ).toBeVisible();
  return new URL(page.url()).pathname;
}

async function saveDraft(page: Page, number: number) {
  await page.getByRole("button", { name: "Save draft" }).first().click();
  await expect(
    page.getByRole("status").filter({ hasText: `Draft saved as version ${number}` }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  superAdmin = await createAccount("p-super", "super_admin");
  admin = await createAccount("p-admin", "admin");
  inactiveAdmin = await createAccount("p-inactive", "admin", { inactive: true });
  trainer = await createAccount("p-trainer", "trainer");
  student = await createAccount("p-student", "student");
  activeProgram = await createProgram("ACT", "active");
  draftProgram = await createProgram("DRF", "draft");
  upcomingBatch = await createBatch(activeProgram.id, "UP", "upcoming", "2027-03-06");
  completedBatch = await createBatch(activeProgram.id, "DONE", "completed", "2026-01-10");
  activeLmsBefore = await readProgram(activeProgram.id);
});

test("1. an Admin sets up a Program's website content and saves a draft", async ({
  browser,
}) => {
  const page = await adminPage(browser, admin);
  activePath = await setUpWebsite(page, activeProgram, `e2e-active-${RUN_ID}`);
  await page.locator("#page-title").fill(HEADLINE);
  await page.locator("#page-summary").fill(DRAFT_MARKER);
  await saveDraft(page, 1);

  const doc = await readProgramDocument(activeProgram.id);
  expect(doc).toMatchObject({
    slug: `e2e-active-${RUN_ID}`,
    latestRevisionNumber: 1,
    publishedRevisionId: null,
  });
  expect(await readAuditActions(doc!.id)).toEqual([
    "website_document.created",
    "website_document.draft_saved",
  ]);
  // Website content is separate: the LMS Program is untouched.
  expect(await readProgram(activeProgram.id)).toEqual(activeLmsBefore);

  draftPath = await setUpWebsite(page, draftProgram, `e2e-draft-${RUN_ID}`);
  await page.locator("#page-title").fill(`E2E Draft Program ${RUN_ID}`);
  await saveDraft(page, 1);
});

test("2. forbidden roles cannot open any Program website screen", async ({
  browser,
  playwright,
  baseURL,
}) => {
  const routes = [
    "/admin/website/programs",
    "/admin/website/groups",
    "/admin/website/featured",
    activePath,
    `${activePath}/settings`,
    `${activePath}/batches`,
    `${activePath}/history`,
    `${activePath}/preview`,
  ];

  const anonymous = await playwright.request.newContext({ baseURL, maxRedirects: 0 });
  for (const route of routes) {
    const response = await anonymous.get(route);
    expect([303, 307, 308], route).toContain(response.status());
    expect(response.headers()["location"], route).toContain("/login/admin");
    expect(await response.text(), route).not.toContain(DRAFT_MARKER);
  }
  await anonymous.dispose();

  for (const [account, loginPath, home] of [
    [student, "/login/student", /^https?:\/\/[^/]+\/student$/],
    [trainer, "/login/trainer", /^https?:\/\/[^/]+\/trainer$/],
  ] as const) {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, loginPath, account);
    await expect(page).toHaveURL(home);
    for (const route of routes) {
      await page.goto(route);
      await expect(page, `${account.role} ${route}`).toHaveURL(home);
      await expect(page.locator("body")).not.toContainText(DRAFT_MARKER);
      await expect(page.locator("body")).not.toContainText(HEADLINE);
    }
  }

  const inactive = await (await browser.newContext()).newPage();
  await signIn(inactive, "/login/admin", inactiveAdmin);
  await inactive.waitForLoadState("networkidle");
  for (const route of routes) {
    await inactive.goto(route);
    await expect(inactive, `inactive admin ${route}`).not.toHaveURL(/\/admin\/website/);
    await expect(inactive.locator("body")).not.toContainText(DRAFT_MARKER);
  }
});

test("3. every Program website route is private and the preview is not public", async ({
  browser,
  playwright,
  baseURL,
}) => {
  const page = await adminPage(browser, admin);
  for (const route of [
    "/admin/website/programs",
    "/admin/website/groups",
    "/admin/website/featured",
    activePath,
    `${activePath}/settings`,
    `${activePath}/batches`,
    `${activePath}/history`,
  ]) {
    const response = await page.request.get(route);
    expect(response.status(), route).toBe(200);
    expectPrivateHeaders(response);
  }
  const preview = await page.request.get(`${activePath}/preview`);
  expectPrivateHeaders(preview);
  const html = await preview.text();
  expect(html).toMatch(/<meta name="robots" content="noindex/);
  expect(html).toContain("Preview: not public");
  expect(html).toContain(DRAFT_MARKER);

  const anonymous = await playwright.request.newContext({ baseURL, maxRedirects: 0 });
  const denied = await anonymous.get(`${activePath}/preview`);
  expect([303, 307, 308]).toContain(denied.status());
  expect(await denied.text()).not.toContain(DRAFT_MARKER);
  await anonymous.dispose();
});

test("4. only a Program active in the LMS can be published", async ({ browser }) => {
  const page = await adminPage(browser, admin);

  await page.goto(draftPath);
  await expect(
    page.getByRole("button", { name: "Publish…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Only a Program that is active in the LMS can be published/),
  ).toBeVisible();
  expect((await readProgramDocument(draftProgram.id))?.publishedRevisionId).toBeNull();

  await page.goto(activePath);
  const panel = page.locator('[aria-labelledby="publication-heading"]');
  await page.getByRole("button", { name: "Publish…", exact: true }).click();
  await expect(page.getByText(/live content for this Program\./)).toBeVisible();
  await page.getByRole("button", { name: "Confirm publish" }).click();
  await expect(page.getByText("now the live content for this Program")).toBeVisible();
  await expect(panel.getByText("Published", { exact: true })).toBeVisible();

  const doc = await readProgramDocument(activeProgram.id);
  expect(doc?.publishedRevisionId).toBe(doc?.latestRevisionId);
  expect(await readAuditActions(doc!.id)).toContain("website_document.published");
});

test("5. a published Program's web address is locked; an unpublished one can change", async ({
  browser,
}) => {
  for (const account of [admin, superAdmin]) {
    const page = await adminPage(browser, account);
    await page.goto(`${activePath}/settings`);
    await expect(
      page.getByText(/cannot be changed until redirects from old addresses are in place/),
    ).toBeVisible();
    await expect(page.getByLabel("New web address")).toHaveCount(0);
  }
  expect((await readProgramDocument(activeProgram.id))?.slug).toBe(
    `e2e-active-${RUN_ID}`,
  );

  const page = await adminPage(browser, admin);
  await page.goto(`${draftPath}/settings`);
  await page.getByLabel("New web address").fill(`e2e-draft-renamed-${RUN_ID}`);
  await page.getByRole("button", { name: "Change web address" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Web address changed." }),
  ).toBeVisible();
  const doc = await readProgramDocument(draftProgram.id);
  expect(doc?.slug).toBe(`e2e-draft-renamed-${RUN_ID}`);
  expect(await readAuditActions(doc!.id)).toContain("website_document.slug_changed");
});

test("6. display groups can be created, renamed, hidden, reordered, archived and restored", async ({
  browser,
}) => {
  const page = await adminPage(browser, admin);
  await page.goto("/admin/website/groups");
  const create = page.getByRole("form", { name: "Create a display group" });
  for (const name of [GROUP_A, GROUP_B]) {
    await create.getByLabel("Group name").fill(name);
    await create.getByRole("button", { name: "Create group" }).click();
    await expect(page.getByText(`Display group "${name}" created.`)).toBeVisible();
  }

  await page.getByRole("button", { name: `Edit ${GROUP_A}` }).click();
  const row = page.getByRole("listitem").filter({ hasText: GROUP_A });
  await row.getByLabel("Group name").fill(GROUP_A_RENAMED);
  await row.getByLabel(/Visible on the website/).uncheck();
  await row.getByRole("button", { name: "Save group" }).click();
  await expect(page.getByText("Display group saved.")).toBeVisible();

  await page.getByRole("button", { name: `Move ${GROUP_B} up` }).click();
  await expect(page.getByText(/Group order saved/).first()).toBeVisible();

  const groups = await readDisplayGroups([GROUP_A_RENAMED, GROUP_B]);
  expect(groups.map((g) => g.name)).toEqual([GROUP_B, GROUP_A_RENAMED]);
  expect(groups.find((g) => g.name === GROUP_A_RENAMED)?.is_visible).toBe(false);
  const groupA = groups.find((g) => g.name === GROUP_A_RENAMED)!;
  expect(await readAuditActions(groupA.id)).toEqual(
    expect.arrayContaining([
      "website_display_group.created",
      "website_display_group.updated",
    ]),
  );

  // Archive needs confirmation; Cancel changes nothing.
  const activeList = page.getByRole("region", { name: "Groups in display order" });
  const archivedList = page.getByRole("list", { name: "Archived groups" });
  await page.getByRole("button", { name: `Archive ${GROUP_A_RENAMED}` }).click();
  await expect(
    page.getByText(`Archive "${GROUP_A_RENAMED}"? It holds no Programs`),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Confirm archive" })).toHaveCount(0);
  expect((await readDisplayGroupState(groupA.id)).archived_at).toBeNull();

  await page.getByRole("button", { name: `Archive ${GROUP_A_RENAMED}` }).click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `Display group "${GROUP_A_RENAMED}" archived.` }),
  ).toBeVisible();
  await expect(archivedList.getByText(GROUP_A_RENAMED)).toBeVisible();
  await expect(
    activeList.getByRole("button", { name: `Edit ${GROUP_A_RENAMED}` }),
  ).toHaveCount(0);
  expect((await readDisplayGroupState(groupA.id)).archived_at).not.toBeNull();
  expect(await readAuditActions(groupA.id)).toContain("website_display_group.archived");

  // A group holding a Program cannot be archived; the Program keeps its group.
  await create.getByLabel("Group name").fill(GROUP_C);
  await create.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByText(`Display group "${GROUP_C}" created.`)).toBeVisible();
  const [groupC] = await readDisplayGroups([GROUP_C]);
  const stale = await adminPage(browser, superAdmin);
  await stale.goto("/admin/website/groups");
  await expect(stale.getByRole("button", { name: `Archive ${GROUP_C}` })).toBeEnabled();
  await page.goto(`${draftPath}/settings`);
  await page.getByLabel("Display group").selectOption({ label: GROUP_C });
  await page.getByRole("button", { name: "Save placement…" }).click();
  await page.getByRole("button", { name: "Confirm placement" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Placement saved" }),
  ).toBeVisible();
  await stale.getByRole("button", { name: `Archive ${GROUP_C}` }).click();
  await stale.getByRole("button", { name: "Confirm archive" }).click();
  await expect(
    stale.getByRole("alert").filter({
      hasText: /Move its Programs to another group first.*hide the group instead/,
    }),
  ).toBeVisible();
  expect((await readDisplayGroupState(groupC.id)).archived_at).toBeNull();
  expect((await readProgramDocument(draftProgram.id))?.displayGroupId).toBe(groupC.id);
  expect(await readAuditActions(groupC.id)).not.toContain(
    "website_display_group.archived",
  );
  await stale.reload();
  await expect(stale.getByRole("button", { name: `Archive ${GROUP_C}` })).toBeDisabled();

  // Restore is refused while an active group uses the archived group's name.
  await page.goto("/admin/website/groups");
  await expect(
    page.getByRole("button", { name: `Restore ${GROUP_A_RENAMED}` }),
  ).toBeEnabled();
  await create.getByLabel("Group name").fill(GROUP_A_RENAMED);
  await create.getByRole("button", { name: "Create group" }).click();
  await expect(
    page.getByText(`Display group "${GROUP_A_RENAMED}" created.`),
  ).toBeVisible();
  await stale.getByRole("button", { name: `Restore ${GROUP_A_RENAMED}` }).click();
  await expect(
    stale
      .getByRole("alert")
      .filter({ hasText: /already uses this name, so this group cannot be restored/ }),
  ).toBeVisible();
  expect((await readDisplayGroupState(groupA.id)).archived_at).not.toBeNull();
  expect(await readAuditActions(groupA.id)).not.toContain(
    "website_display_group.restored",
  );
  await expect(
    page.getByRole("button", { name: `Restore ${GROUP_A_RENAMED}` }),
  ).toBeDisabled();

  // Renaming the active twin frees the name; restore puts the group last, still hidden.
  await activeList.getByRole("button", { name: `Edit ${GROUP_A_RENAMED}` }).click();
  const twin = activeList
    .getByRole("listitem")
    .filter({ has: page.getByLabel("Group name") });
  await twin.getByLabel("Group name").fill(GROUP_A_TWIN);
  await twin.getByRole("button", { name: "Save group" }).click();
  await expect(page.getByText("Display group saved.")).toBeVisible();
  await page.getByRole("button", { name: `Restore ${GROUP_A_RENAMED}` }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Display group restored." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Restore ${GROUP_A_RENAMED}` }),
  ).toHaveCount(0);
  await expect(
    activeList.getByRole("button", { name: `Edit ${GROUP_A_RENAMED}`, exact: true }),
  ).toBeVisible();
  const restored = await readDisplayGroupState(groupA.id);
  expect(restored.archived_at).toBeNull();
  expect(restored.is_visible).toBe(false);
  expect(restored.display_order).toBe(await readMaxActiveGroupOrder());
  expect(await readAuditActions(groupA.id)).toEqual(
    expect.arrayContaining([
      "website_display_group.archived",
      "website_display_group.restored",
    ]),
  );
  await stale.context().close();
});

test("7. placement and featured order are confirmed, audited and stale-safe", async ({
  browser,
}) => {
  const page = await adminPage(browser, admin);
  for (const path of [activePath, draftPath]) {
    await page.goto(`${path}/settings`);
    await page.getByLabel("Display group").selectOption({ label: GROUP_B });
    await page.getByLabel("Featured Program").check();
    await page.getByRole("button", { name: "Save placement…" }).click();
    await expect(page.getByText(/will be added to the featured Programs/)).toBeVisible();
    await page.getByRole("button", { name: "Confirm placement" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Placement saved" }),
    ).toBeVisible();
  }
  const [groupB] = await readDisplayGroups([GROUP_B]);
  const active = await readProgramDocument(activeProgram.id);
  const draft = await readProgramDocument(draftProgram.id);
  expect(active).toMatchObject({ displayGroupId: groupB.id, isFeatured: true });
  expect(draft).toMatchObject({ displayGroupId: groupB.id, isFeatured: true });
  expect(draft!.featuredOrder!).toBeGreaterThan(active!.featuredOrder!);

  await page.goto("/admin/website/featured");
  await page.getByRole("button", { name: `Move ${draftProgram.name} up` }).click();
  await expect(
    page.getByText(/applies to the public website straight away/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm move" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Featured order saved" }),
  ).toBeVisible();
  const activeAfter = await readProgramDocument(activeProgram.id);
  const draftAfter = await readProgramDocument(draftProgram.id);
  expect(draftAfter!.featuredOrder!).toBeLessThan(activeAfter!.featuredOrder!);
  expect(await readAuditActions(draftAfter!.id)).toContain(
    "website_document.placement_updated",
  );

  // Two editors on the same settings: the second, stale save is refused.
  const first = await adminPage(browser, admin);
  const second = await adminPage(browser, superAdmin);
  await first.goto(`${activePath}/settings`);
  await second.goto(`${activePath}/settings`);
  await first.getByLabel("Order within the group").fill("3");
  await first.getByRole("button", { name: "Save placement…" }).click();
  await first.getByRole("button", { name: "Confirm placement" }).click();
  await expect(
    first.getByRole("status").filter({ hasText: "Placement saved" }),
  ).toBeVisible();
  await second.getByLabel("Order within the group").fill("9");
  await second.getByRole("button", { name: "Save placement…" }).click();
  await second.getByRole("button", { name: "Confirm placement" }).click();
  await expect(
    second.getByRole("alert").filter({ hasText: STALE_MESSAGE }),
  ).toBeVisible();
});

test("8. Batches are published with a public label and registration state only", async ({
  browser,
}) => {
  const page = await adminPage(browser, admin);
  await page.goto(`${activePath}/batches`);
  const card = page.getByRole("listitem").filter({ hasText: upcomingBatch.name });
  await expect(card.getByText("(internal name, never shown publicly)")).toBeVisible();

  await card.getByLabel("Public label").fill(BATCH_LABEL);
  await card.getByLabel("Open", { exact: true }).check();
  await card.getByRole("button", { name: "Save website settings" }).click();
  await expect(card.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await card.getByRole("button", { name: "Publish…", exact: true }).click();
  await card.getByRole("button", { name: "Confirm publish" }).click();
  await expect(card.getByText("On the website:")).toContainText(`${BATCH_LABEL} · Open`);
  expect(await readBatchPublication(upcomingBatch.id)).toMatchObject({
    is_published: true,
    published_label: BATCH_LABEL,
    published_registration_state: "open",
  });

  await card.getByLabel("Full", { exact: true }).check();
  await card.getByRole("button", { name: "Save website settings" }).click();
  await expect(card.getByText("Published, with unpublished changes")).toBeVisible();
  await card.getByRole("button", { name: "Publish…", exact: true }).click();
  await card.getByRole("button", { name: "Confirm publish" }).click();
  await expect(card.getByText("On the website:")).toContainText(`${BATCH_LABEL} · Full`);

  // The preview shows the public label, never the internal Batch name.
  await page.goto(`${activePath}/preview`);
  await expect(page.getByText(`${BATCH_LABEL} · Registration Full`)).toBeVisible();
  await expect(page.locator("main")).not.toContainText(upcomingBatch.name);

  await page.goto(`${activePath}/batches`);
  const completed = page.getByRole("listitem").filter({ hasText: completedBatch.name });
  await expect(
    completed.getByRole("button", { name: "Publish…", exact: true }),
  ).toBeDisabled();
  await expect(
    completed.getByText(
      "Only an upcoming or active Batch can be published on the website.",
    ),
  ).toBeVisible();

  const again = page.getByRole("listitem").filter({ hasText: upcomingBatch.name });
  await again.getByRole("button", { name: "Unpublish…" }).click();
  await again.getByRole("button", { name: "Confirm unpublish" }).click();
  await expect(again.getByText("Unpublished", { exact: true })).toBeVisible();
  expect((await readBatchPublication(upcomingBatch.id))?.is_published).toBe(false);
  expect(await readAuditActions(upcomingBatch.id)).toEqual(
    expect.arrayContaining([
      "batch_website_publication.draft_saved",
      "batch_website_publication.published",
      "batch_website_publication.unpublished",
    ]),
  );
});
