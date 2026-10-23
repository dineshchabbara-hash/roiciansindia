import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createAccount, type TestAccount } from "./support/phase22b-fixtures";
import {
  MEDIA_BUCKET,
  RUN_ID,
  countStoredFolders,
  isIsolatedLocalSupabase,
  isMediaMigrationApplied,
  makePng,
  publicUrlStatus,
  readAuditEntries,
  readLatestRevisionImages,
  readMedia,
  readMediaByFileName,
  storedFileExists,
  userClient,
} from "./support/phase22b3-fixtures";

/**
 * Phase 22B-3 Website Media acceptance.
 *
 * ISOLATED ONLY, and only with the reviewed media upload migration applied to
 * that throwaway stack: skips unless PHASE22B_E2E_ISOLATED=1, the Supabase
 * URL is local, and PHASE22B3_MEDIA_MIGRATION=1. Every image is a fictional
 * gradient generated in code.
 *
 *   1. An Admin uploads an image: its bytes are checked, it is stored
 *      privately (no public URL) and recorded as a Draft, and audited.
 *   2. Files that are not real images, or too large, are refused before
 *      anything is stored; Storage itself refuses other types and overwrites.
 *   3. Only active Admins reach the media screens, the bucket and the
 *      functions (Trainer, Student, inactive Admin, anonymous refused).
 *   4. Approval needs suitable alt text, is confirmed and audited; a stale
 *      change is refused.
 *   5. Admins choose Approved images for a page; the page publishes; an
 *      image used by published content keeps its approval.
 *   6. An image that is not Approved holds publishing (screen and database).
 *   7. Retired images cannot be chosen or saved; restore returns to Draft;
 *      the audit trail records each change.
 *   8. Unrecorded uploads: the uploader can remove their own at once; other
 *      Admins cannot until 24 hours; recorded images cannot be removed.
 */

test.describe.configure({ mode: "serial" });

test.skip(
  !isIsolatedLocalSupabase() || !isMediaMigrationApplied(),
  "Phase 22B-3 E2E runs only against a local, disposable Supabase stack with the reviewed media migration applied (PHASE22B_E2E_ISOLATED=1, PHASE22B3_MEDIA_MIGRATION=1).",
);

const ADMIN_HOME = /^https?:\/\/[^/]+\/admin$/;
const UUID_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//;
const STALE_MESSAGE = /Someone else changed this image|changed by someone else/i;

const FIRST = `Sample-classroom-${RUN_ID}.png`;
const SECOND = `Sample-team-${RUN_ID}.png`;
const ALT_FIRST = `Sample: learners in a classroom ${RUN_ID}`;
const ALT_SECOND = `Sample: a trainer with a small group ${RUN_ID}`;
const PAGE_TITLE = `For Institutions ${RUN_ID}`;

let superAdmin: TestAccount;
let admin: TestAccount;
let inactiveAdmin: TestAccount;
let trainer: TestAccount;
let student: TestAccount;
let firstId = "";
let secondId = "";
let pagePath = "";
let pageId = "";

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

async function upload(page: Page, name: string, buffer: Buffer, alt: string) {
  await page.goto("/admin/website/media");
  const form = page.getByRole("form", { name: "Upload an image" });
  await form
    .getByLabel("Image file")
    .setInputFiles({ name, mimeType: "image/png", buffer });
  await expect(form.getByText(/PNG · \d+ × \d+ px/)).toBeVisible();
  if (alt) await form.getByLabel(/Alt text/).fill(alt);
  await form.getByRole("button", { name: /Upload image/ }).click();
  await expect(form.getByRole("status").filter({ hasText: "as a Draft" })).toBeVisible();
}

async function changeStatus(
  page: Page,
  mediaId: string,
  button: string,
  confirm?: string,
) {
  await page.goto(`/admin/website/media/${mediaId}`);
  await page.getByRole("button", { name: button }).click();
  if (confirm) await page.getByRole("button", { name: confirm }).click();
}

test.beforeAll(async () => {
  superAdmin = await createAccount("m-super", "super_admin");
  admin = await createAccount("m-admin", "admin");
  inactiveAdmin = await createAccount("m-inactive", "admin", { inactive: true });
  trainer = await createAccount("m-trainer", "trainer");
  student = await createAccount("m-student", "student");
});

test("1. an Admin uploads an image: checked, stored privately, recorded as a Draft", async ({
  browser,
}) => {
  const page = await adminPage(browser, admin);
  const bytes = makePng(1200, 675);
  await upload(page, FIRST, bytes, ALT_FIRST);

  const row = await readMediaByFileName(FIRST);
  expect(row).toMatchObject({
    mime_type: "image/png",
    byte_size: bytes.length,
    width: 1200,
    height: 675,
    alt_text: ALT_FIRST,
    status: "draft",
  });
  expect(row!.storage_path).toMatch(UUID_PATH);
  firstId = row!.id;
  expect(await storedFileExists(row!.storage_path)).toBe(true);
  expect(await publicUrlStatus(row!.storage_path)).not.toBe(200);

  const audit = await readAuditEntries(firstId);
  expect(audit[0]).toMatchObject({
    action: "website_media_asset.registered",
    after_data: expect.objectContaining({ width: 1200, height: 675, status: "draft" }),
  });

  await page.goto("/admin/website/media?status=draft");
  await expect(page.getByRole("link", { name: `Details for ${FIRST}` })).toBeVisible();
});

test("2. files that are not real images, or too large, are refused before anything is stored", async ({
  browser,
}) => {
  const page = await adminPage(browser, admin);
  const before = await countStoredFolders();
  await page.goto("/admin/website/media");
  const form = page.getByRole("form", { name: "Upload an image" });
  const input = form.getByLabel("Image file");
  const button = form.getByRole("button", { name: /Upload image/ });

  await input.setInputFiles({
    name: "fake.png",
    mimeType: "image/png",
    buffer: Buffer.from("<html><script>alert(1)</script></html>"),
  });
  await expect(form.getByText(/not a valid JPEG, PNG or WebP/)).toBeVisible();
  await expect(button).toBeDisabled();

  const tooBig = Buffer.concat([makePng(4, 4), Buffer.alloc(5 * 1024 * 1024)]);
  await input.setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: tooBig });
  await expect(form.getByText(/larger than 5 MB/)).toBeVisible();
  await expect(button).toBeDisabled();
  expect(await countStoredFolders()).toBe(before);

  // Storage itself refuses other types, and overwriting a recorded image.
  const client = await userClient(admin);
  for (const [type, body] of [
    ["text/html", "<html></html>"],
    ["image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg"/>'],
  ] as const) {
    const path = `${crypto.randomUUID()}/sneaky-${RUN_ID}.png`;
    const link = await client.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
    expect(link.error).toBeNull();
    const sent = await client.storage
      .from(MEDIA_BUCKET)
      .uploadToSignedUrl(path, link.data!.token, new Blob([body], { type }), {
        contentType: type,
      });
    expect(sent.error, type).not.toBeNull();
  }
  const recorded = (await readMedia(firstId)).storage_path;
  const overwrite = await client.storage
    .from(MEDIA_BUCKET)
    .createSignedUploadUrl(recorded, { upsert: true });
  expect(overwrite.error).not.toBeNull();
  const replace = await client.storage
    .from(MEDIA_BUCKET)
    .upload(recorded, new Blob([new Uint8Array(makePng(2, 2))], { type: "image/png" }), {
      upsert: true,
    });
  expect(replace.error).not.toBeNull();
  expect((await readMedia(firstId)).byte_size).toBe(makePng(1200, 675).length);
});

test("3. only active Admins reach the media screens, the bucket and the functions", async ({
  browser,
  playwright,
  baseURL,
}) => {
  const routes = ["/admin/website/media", `/admin/website/media/${firstId}`];
  const anonymous = await playwright.request.newContext({ baseURL, maxRedirects: 0 });
  for (const route of routes) {
    const response = await anonymous.get(route);
    expect([303, 307, 308], route).toContain(response.status());
    expect(response.headers()["location"], route).toContain("/login/admin");
    expect(await response.text(), route).not.toContain(ALT_FIRST);
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
      await expect(page.locator("body")).not.toContainText(ALT_FIRST);
    }
  }
  const inactive = await (await browser.newContext()).newPage();
  await signIn(inactive, "/login/admin", inactiveAdmin);
  await inactive.waitForLoadState("networkidle");
  for (const route of routes) {
    await inactive.goto(route);
    await expect(inactive, `inactive admin ${route}`).not.toHaveURL(/\/admin\/website/);
  }

  const recorded = (await readMedia(firstId)).storage_path;
  for (const account of [trainer, student, inactiveAdmin]) {
    const client = await userClient(account);
    const [folder] = recorded.split("/");
    const listed = await client.storage.from(MEDIA_BUCKET).list(folder);
    expect(listed.data ?? [], account.role).toEqual([]);
    const link = await client.storage
      .from(MEDIA_BUCKET)
      .createSignedUploadUrl(`${crypto.randomUUID()}/x.png`);
    expect(link.error, account.role).not.toBeNull();
    const rows = await client.from("website_media_assets").select("id");
    expect(rows.data ?? [], account.role).toEqual([]);
    const update = await client.rpc("website_update_media_asset", {
      p_asset_id: firstId,
      p_expected_version: 1,
      p_alt_text: "x",
      p_status: "approved",
    });
    expect(update.error, account.role).not.toBeNull();
    const incomplete = await client.rpc("website_incomplete_media_uploads");
    expect(incomplete.error, account.role).not.toBeNull();
  }
  expect((await readMedia(firstId)).status).toBe("draft");
});

test("4. approval needs suitable alt text, is confirmed and audited; stale changes are refused", async ({
  browser,
}) => {
  const page = await adminPage(browser, admin);
  await upload(page, SECOND, makePng(800, 600, 40), "");
  secondId = (await readMediaByFileName(SECOND))!.id;

  await page.goto(`/admin/website/media/${secondId}`);
  await expect(page.getByRole("button", { name: "Approve…" })).toBeDisabled();
  await expect(page.getByText(/Before approving: Add alt text/)).toBeVisible();

  const alt = page.getByLabel("Alt text", { exact: true });
  await alt.fill(SECOND);
  await page.getByRole("button", { name: "Save alt text" }).click();
  await expect(page.getByText(/not repeat its file name/).first()).toBeVisible();
  await alt.fill(ALT_SECOND);
  await page.getByRole("button", { name: "Save alt text" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Alt text saved." }),
  ).toBeVisible();

  // A second Admin opens the same image, then the first approves it.
  const other = await adminPage(browser, superAdmin);
  await other.goto(`/admin/website/media/${secondId}`);
  await changeStatus(page, secondId, "Approve…", "Confirm: approve");
  await expect(
    page.getByRole("status").filter({ hasText: "Image approved" }),
  ).toBeVisible();
  await other.getByRole("button", { name: "Retire…" }).click();
  await other.getByRole("button", { name: "Confirm: retire" }).click();
  await expect(other.getByRole("alert").filter({ hasText: STALE_MESSAGE })).toBeVisible();

  expect((await readMedia(secondId)).status).toBe("approved");
  const audit = await readAuditEntries(secondId);
  expect(audit.map((a) => a.after_data?.change ?? a.action)).toEqual([
    "website_media_asset.registered",
    "alt_text",
    "approved",
  ]);
  expect(audit[1]).toMatchObject({
    before_data: { altText: null },
    after_data: expect.objectContaining({ altText: ALT_SECOND }),
  });
});

test("5. Admins choose Approved images for a page; it publishes; a published image keeps its approval", async ({
  browser,
}) => {
  const page = await adminPage(browser, admin);
  await page.goto("/admin/website");
  await page.getByRole("button", { name: "Create For Institutions" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "For Institutions" }),
  ).toBeVisible();
  pagePath = new URL(page.url()).pathname;
  pageId = pagePath.split("/").pop()!;

  await page.locator("#page-title").fill(PAGE_TITLE);
  await page.getByRole("button", { name: "Choose main image" }).click();
  // The Draft image is not offered; the Approved one is.
  await expect(page.getByRole("button", { name: `Use image: ${ALT_FIRST}` })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: `Use image: ${ALT_SECOND}` }).click();
  await page.getByLabel("Add a section").selectOption("hero");
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByRole("button", { name: "Choose section image" }).click();
  await page.getByRole("button", { name: `Use image: ${ALT_SECOND}` }).click();
  await page.getByRole("button", { name: "Save draft" }).first().click();
  await expect(
    page.getByRole("status").filter({ hasText: "Draft saved as version 1" }),
  ).toBeVisible();

  const saved = await readLatestRevisionImages(pageId);
  expect(saved.hero_image_asset_id).toBe(secondId);
  expect(saved.sections[0].imageAssetId).toBe(secondId);

  await page.goto(`${pagePath}/preview`);
  await expect(page.getByRole("img", { name: ALT_SECOND }).first()).toBeVisible();

  await page.goto(pagePath);
  await page.getByRole("button", { name: "Publish…", exact: true }).click();
  await page.getByRole("button", { name: "Confirm publish" }).click();
  await expect(page.getByText("now the live content")).toBeVisible();

  await page.goto(`/admin/website/media/${secondId}`);
  await expect(page.getByRole("button", { name: "Retire…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Withdraw approval…" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "For Institutions" })).toBeVisible();
  // The database refuses too, even when called directly.
  const client = await userClient(admin);
  const direct = await client.rpc("website_update_media_asset", {
    p_asset_id: secondId,
    p_expected_version: (await readMedia(secondId)).version,
    p_alt_text: ALT_SECOND,
    p_status: "retired",
  });
  expect(direct.error?.code).toBe("P2206");
  expect((await readMedia(secondId)).status).toBe("approved");
});

test("6. an image that is not Approved holds publishing", async ({ browser }) => {
  const page = await adminPage(browser, admin);
  await changeStatus(page, firstId, "Approve…", "Confirm: approve");
  await expect(
    page.getByRole("status").filter({ hasText: "Image approved" }),
  ).toBeVisible();

  await page.goto(pagePath);
  await page.getByRole("button", { name: "Choose social sharing image" }).click();
  await page.getByRole("button", { name: `Use image: ${ALT_FIRST}` }).click();
  await page.getByRole("button", { name: "Save draft" }).first().click();
  await expect(
    page.getByRole("status").filter({ hasText: "Draft saved as version 2" }),
  ).toBeVisible();

  await changeStatus(page, firstId, "Withdraw approval…", "Confirm: withdraw approval");
  await expect(
    page.getByRole("status").filter({ hasText: "Approval withdrawn" }),
  ).toBeVisible();

  await page.goto(pagePath);
  await expect(
    page.getByRole("button", { name: "Publish…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Every image must be Approved before publishing/).first(),
  ).toBeVisible();
  await expect(page.getByText(/This image is not Approved/)).toBeVisible();

  const client = await userClient(admin);
  const revision = await readLatestRevisionImages(pageId);
  const direct = await client.rpc("website_publish_document", {
    p_document_id: pageId,
    p_revision_id: revision.latestRevisionId!,
  });
  expect(direct.error?.code).toBe("P2206");
  expect((await readLatestRevisionImages(pageId)).publishedRevisionId).not.toBe(
    revision.latestRevisionId,
  );
});

test("7. retired images cannot be chosen or saved; restore returns to Draft; every change is audited", async ({
  browser,
}) => {
  const page = await adminPage(browser, admin);
  await changeStatus(page, firstId, "Retire…", "Confirm: retire");
  await expect(
    page.getByRole("status").filter({ hasText: "Image retired" }),
  ).toBeVisible();

  await page.goto(pagePath);
  await page.getByRole("button", { name: "Change main image" }).click();
  await expect(page.getByRole("button", { name: `Use image: ${ALT_FIRST}` })).toHaveCount(
    0,
  );
  await page.locator("#page-summary").fill(`Edited ${RUN_ID}`);
  await page.getByRole("button", { name: "Save draft" }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: /retired/i })).toBeVisible();
  expect((await readLatestRevisionImages(pageId)).social_image_asset_id).toBe(firstId);

  await changeStatus(page, firstId, "Restore to Draft");
  await expect(
    page.getByRole("status").filter({ hasText: "restored to Draft" }),
  ).toBeVisible();
  expect((await readMedia(firstId)).status).toBe("draft");
  const changes = (await readAuditEntries(firstId))
    .filter((a) => a.action === "website_media_asset.updated")
    .map((a) => a.after_data?.change);
  expect(changes).toEqual(["approved", "approval_withdrawn", "retired", "restored"]);
});

test("8. unrecorded uploads: the uploader removes their own; others wait 24 hours; recorded images stay", async () => {
  const adminClient = await userClient(admin);
  const otherClient = await userClient(superAdmin);
  const path = `${crypto.randomUUID()}/abandoned-${RUN_ID}.png`;
  const link = await adminClient.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  expect(link.error).toBeNull();
  const sent = await adminClient.storage
    .from(MEDIA_BUCKET)
    .uploadToSignedUrl(
      path,
      link.data!.token,
      new Blob([new Uint8Array(makePng(16, 9))], { type: "image/png" }),
      {
        contentType: "image/png",
      },
    );
  expect(sent.error).toBeNull();
  expect(await storedFileExists(path)).toBe(true);

  const listed = await adminClient.rpc("website_incomplete_media_uploads");
  expect(listed.error).toBeNull();
  expect(
    (listed.data as Array<{ storage_path: string }>).map((r) => r.storage_path),
  ).not.toContain(path);

  await otherClient.storage.from(MEDIA_BUCKET).remove([path]);
  expect(await storedFileExists(path)).toBe(true);
  await adminClient.storage.from(MEDIA_BUCKET).remove([path]);
  expect(await storedFileExists(path)).toBe(false);

  const recorded = (await readMedia(firstId)).storage_path;
  await adminClient.storage.from(MEDIA_BUCKET).remove([recorded]);
  await otherClient.storage.from(MEDIA_BUCKET).remove([recorded]);
  expect(await storedFileExists(recorded)).toBe(true);
});
