import { test, expect, type Page } from "@playwright/test";
import {
  hasRealSupabaseCredentials,
  createPhase18Identity,
  deletePhase18Identity,
  Phase18PartialIdentityError,
  type Phase18Identity,
  type Phase18Role,
  type Phase18DeleteResult,
  displayName,
  signInAs,
  anonymousClient,
  sendNotificationAsAdmin,
  readNotification,
  readNotificationsForRecipient,
  readSendAuditRows,
  PHASE18_E2E_PREFIX,
  RUN_ID,
} from "./support/phase18-fixtures";

/**
 * Phase 18 (Notifications V1 — in-app only) acceptance suite, run against
 * the real dev Supabase project through the running app. Four independent
 * describe blocks; each owns its own synthetic identities and rows (no
 * shared state, no execution-order dependency), so each test can be run on
 * its own with `-g`.
 *
 *   1. Admin sends an in-app notification to a Student through the UI —
 *      durable proof is the "Recently sent" row; stored sender is the
 *      authenticated Admin; the audit row is minimal.
 *   2. Student reads their own notification — unread count/badge, mark as
 *      read, read state survives reload.
 *   3. Recipient isolation — a second Student and a Trainer cannot see
 *      someone else's notification; the recipient cannot rewrite it; direct
 *      API tampering is denied; a Student cannot open the Admin send page.
 *   4. Mark all as read persists; sent history is private to the sending
 *      Admin.
 *
 * Every assertion waits on durable, server-rendered state (list items,
 * their "Unread"/"Read" badge, the exact unread summary, the nav link's
 * accessible name) — never a toast, a pending button label, or a sleep.
 * The full RLS matrix is proven in supabase/tests/phase18_notifications_
 * test.sql; this suite covers only what needs a real browser/session.
 */

test.describe.configure({ mode: "serial" });

const skipSuite = !hasRealSupabaseCredentials();

test.skip(
  skipSuite,
  "Phase 18 live E2E suite requires real dev Supabase credentials in .env.local " +
    "(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY). " +
    "Skipped, not failed, without a live dev project.",
);

// ---------------------------------------------------------------------------
// Shared helpers.

async function login(page: Page, identity: Phase18Identity) {
  await page.goto(`/login/${identity.role}`);
  await page.locator("#email").fill(identity.email);
  await page.locator("#password").fill(identity.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (identity.role === "admin") {
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();
  } else {
    await expect(page).toHaveURL(new RegExp(`/${identity.role}$`));
    await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  }
}

async function switchUser(page: Page, identity: Phase18Identity) {
  await page.context().clearCookies();
  await login(page, identity);
}

function inboxItem(page: Page, title: string) {
  return page
    .getByRole("list", { name: "Your notifications" })
    .getByRole("listitem", { name: title });
}

function sentItem(page: Page, title: string) {
  return page
    .getByRole("list", { name: "Recently sent notifications" })
    .getByRole("listitem", { name: title });
}

function portalNav(page: Page, role: "student" | "trainer") {
  return page.getByRole("navigation", {
    name: role === "student" ? "Student navigation" : "Trainer navigation",
  });
}

/** The single Notifications link in the Student nav, with or without a badge. */
function studentNotificationsLink(page: Page) {
  return portalNav(page, "student").getByRole("link", { name: /^Notifications\b/ });
}

async function createTracked(
  role: Phase18Role,
  tag: string,
  tracked: Phase18Identity[],
): Promise<Phase18Identity> {
  try {
    const identity = await createPhase18Identity(role, tag);
    tracked.push(identity);
    return identity;
  } catch (err) {
    if (err instanceof Phase18PartialIdentityError) tracked.push(err.partial);
    throw err;
  }
}

async function cleanup(tracked: Phase18Identity[]): Promise<void> {
  const failures: string[] = [];
  for (const identity of tracked) {
    const result: Phase18DeleteResult = await deletePhase18Identity(identity);
    if (!result.ok) failures.push(`${identity.role} ${identity.email}: ${result.reason}`);
  }
  expect(
    failures,
    failures.length > 0
      ? "One or more synthetic Phase 18 records failed to clean up. Verify by exact id " +
          `only; never broaden deletion:\n${failures.join("\n")}`
      : undefined,
  ).toEqual([]);
}

const uniqueTitle = (label: string) => `${PHASE18_E2E_PREFIX} ${RUN_ID} ${label}`;

// ---------------------------------------------------------------------------
// 1. Admin sends through the real UI.

test.describe("Admin — send notification", () => {
  const tracked: Phase18Identity[] = [];
  let admin: Phase18Identity | undefined;
  let student: Phase18Identity | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    admin = await createTracked("admin", "Sender", tracked);
    student = await createTracked("student", "SendTarget", tracked);
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await cleanup(tracked);
  });

  test("Admin sends an in-app notification to a Student through the UI", async ({
    page,
  }) => {
    if (!admin || !student) throw new Error("Fixture setup incomplete.");
    const title = uniqueTitle("admin UI send");
    const body = `Sent through the Admin UI by ${PHASE18_E2E_PREFIX} run ${RUN_ID}.`;

    await login(page, admin);
    await page.goto("/admin/notifications");
    await expect(
      page.getByRole("heading", { name: "Notifications", level: 1 }),
    ).toBeVisible();

    await page.getByLabel("Find a Student or Trainer").fill(student.email);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(page.getByText("1 matching recipient. Choose one below.")).toBeVisible();

    await page
      .getByLabel("Recipient")
      .selectOption({ label: `${displayName(student)} (Student, ${student.email})` });
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Message").fill(body);
    await page.getByRole("button", { name: "Send notification" }).click();

    // Durable product state: the new row in the sender's own history.
    const row = sentItem(page, title);
    await expect(row).toBeVisible();
    await expect(row.getByText(body)).toBeVisible();
    await expect(row.getByText(`To ${displayName(student)} (Student)`)).toBeVisible();
    await expect(row.getByText("Not yet read", { exact: true })).toBeVisible();

    await page.reload();
    await expect(sentItem(page, title)).toBeVisible();

    // Stored row: sender is the authenticated Admin, recipient is the
    // Student's canonical auth account, V1 shape.
    const stored = await readNotificationsForRecipient(student.authUserId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      recipient_auth_user_id: student.authUserId,
      created_by_auth_user_id: admin.authUserId,
      type: "admin_message",
      channel: "in_app",
      status: "unread",
      read_at: null,
      title,
      body,
    });

    // Minimal audit entry: no title/message text.
    const audit = await readSendAuditRows(stored[0].id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "notification.send",
      actor_auth_user_id: admin.authUserId,
      actor_role: "admin",
      after_data: { recipientAuthUserId: student.authUserId, recipientKind: "student" },
    });
    expect(JSON.stringify(audit[0])).not.toContain(title);
    expect(JSON.stringify(audit[0])).not.toContain(body);
  });
});

// ---------------------------------------------------------------------------
// 2. Student reads their own notification.

test.describe("Student — read own notification", () => {
  const tracked: Phase18Identity[] = [];
  let student: Phase18Identity | undefined;
  let notificationId: string | undefined;
  const title = uniqueTitle("student read");
  const body = "Please read this notification.";

  test.beforeAll(async () => {
    if (skipSuite) return;
    const admin = await createTracked("admin", "ReadSender", tracked);
    student = await createTracked("student", "Reader", tracked);
    notificationId = await sendNotificationAsAdmin({
      admin,
      recipient: student,
      title,
      body,
    });
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await cleanup(tracked);
  });

  test("Student sees their notification, marks it read, and the read state persists", async ({
    page,
  }) => {
    if (!student || !notificationId) throw new Error("Fixture setup incomplete.");

    await login(page, student);
    // Found by its stable identity, then the unread badge asserted on its
    // accessible name separately. Chromium blockifies the flex link's child
    // spans, so its computed name is "Notifications , 1 unread" (a space
    // before the comma) — not jsdom's "Notifications, 1 unread" — hence the
    // whitespace-tolerant pattern rather than one exact composite string.
    const notificationsLink = studentNotificationsLink(page);
    await expect(notificationsLink).toHaveAccessibleName(
      /^Notifications\s*,\s*1 unread$/,
    );
    await notificationsLink.click();
    await expect(page).toHaveURL(/\/student\/notifications$/);

    await expect(page.getByText("1 unread notification", { exact: true })).toBeVisible();
    const item = inboxItem(page, title);
    await expect(item).toBeVisible();
    await expect(item.getByText(body)).toBeVisible();
    await expect(item.getByText("Unread", { exact: true })).toBeVisible();

    await item.getByRole("button", { name: "Mark as read" }).click();

    // Durable: the item's own status and the exact count, re-rendered by
    // the server after the action — not a transient message.
    await expect(item.getByText("Read", { exact: true })).toBeVisible();
    await expect(
      page.getByText("No unread notifications", { exact: true }),
    ).toBeVisible();
    await expect(item.getByRole("button", { name: "Mark as read" })).toHaveCount(0);

    await page.reload();
    await expect(inboxItem(page, title).getByText("Read", { exact: true })).toBeVisible();
    await expect(
      page.getByText("No unread notifications", { exact: true }),
    ).toBeVisible();
    // Badge gone after reading: the link's name is just "Notifications".
    await expect(studentNotificationsLink(page)).toHaveAccessibleName("Notifications");

    const stored = await readNotification(notificationId);
    expect(stored?.status).toBe("read");
    expect(stored?.read_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Recipient isolation and tamper resistance.

test.describe("Recipient isolation", () => {
  const tracked: Phase18Identity[] = [];
  let studentA: Phase18Identity | undefined;
  let studentB: Phase18Identity | undefined;
  let trainer: Phase18Identity | undefined;
  let studentNotificationId: string | undefined;
  const studentTitle = uniqueTitle("private to student A");
  const trainerTitle = uniqueTitle("for the trainer");

  test.beforeAll(async () => {
    if (skipSuite) return;
    const admin = await createTracked("admin", "IsoSender", tracked);
    studentA = await createTracked("student", "IsoA", tracked);
    studentB = await createTracked("student", "IsoB", tracked);
    trainer = await createTracked("trainer", "IsoTrainer", tracked);
    studentNotificationId = await sendNotificationAsAdmin({
      admin,
      recipient: studentA,
      title: studentTitle,
      body: "Only Student A may read this.",
    });
    await sendNotificationAsAdmin({
      admin,
      recipient: trainer,
      title: trainerTitle,
      body: "Only this Trainer may read this.",
    });
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await cleanup(tracked);
  });

  test("Other Students and Trainers cannot see or change someone else's notification", async ({
    page,
  }) => {
    if (!studentA || !studentB || !trainer || !studentNotificationId) {
      throw new Error("Fixture setup incomplete.");
    }

    // Browser: Student B sees an empty inbox and cannot open the Admin page.
    await login(page, studentB);
    await page.goto("/student/notifications");
    await expect(page.getByText("You have no notifications yet.")).toBeVisible();
    await expect(page.getByText(studentTitle)).toHaveCount(0);
    await page.goto("/admin/notifications");
    await expect(page).not.toHaveURL(/\/admin\/notifications/);

    // Browser: the Trainer sees only their own notification.
    await switchUser(page, trainer);
    await page.goto("/trainer/notifications");
    await expect(inboxItem(page, trainerTitle)).toBeVisible();
    await expect(page.getByText(studentTitle)).toHaveCount(0);

    // Direct API, as each real signed-in user (never service role).
    const asStudentB = await signInAs(studentB);
    const asTrainer = await signInAs(trainer);
    const asStudentA = await signInAs(studentA);
    try {
      for (const client of [asStudentB, asTrainer]) {
        const { data: visible } = await client
          .from("notifications")
          .select("id")
          .eq("id", studentNotificationId);
        expect(visible ?? []).toHaveLength(0);

        const { data: changed } = await client
          .from("notifications")
          .update({ status: "read", read_at: new Date().toISOString() })
          .eq("id", studentNotificationId)
          .select("id");
        expect(changed ?? []).toHaveLength(0);
      }

      const titleTamper = await asStudentA
        .from("notifications")
        .update({ title: "Tampered" })
        .eq("id", studentNotificationId)
        .select("id");
      expect(titleTamper.error).not.toBeNull();

      const senderTamper = await asStudentA
        .from("notifications")
        .update({ created_by_auth_user_id: studentA.authUserId })
        .eq("id", studentNotificationId)
        .select("id");
      expect(senderTamper.error).not.toBeNull();

      const readdress = await asStudentA
        .from("notifications")
        .update({ recipient_auth_user_id: studentB.authUserId })
        .eq("id", studentNotificationId)
        .select("id");
      expect(readdress.error).not.toBeNull();

      const { data: deleted } = await asStudentA
        .from("notifications")
        .delete()
        .eq("id", studentNotificationId)
        .select("id");
      expect(deleted ?? []).toHaveLength(0);

      const selfSend = await asStudentA.from("notifications").insert({
        recipient_auth_user_id: studentA.authUserId,
        created_by_auth_user_id: studentA.authUserId,
        type: "admin_message",
        title: uniqueTitle("student self-send"),
        body: "x",
      });
      expect(selfSend.error).not.toBeNull();

      const anon = await anonymousClient()
        .from("notifications")
        .select("id")
        .eq("id", studentNotificationId);
      expect(anon.error !== null || (anon.data ?? []).length === 0).toBe(true);
    } finally {
      await Promise.all(
        [asStudentA, asStudentB, asTrainer].map((c) => c.auth.signOut().catch(() => {})),
      );
    }

    const stored = await readNotification(studentNotificationId);
    expect(stored).toMatchObject({
      title: studentTitle,
      recipient_auth_user_id: studentA.authUserId,
      status: "unread",
    });
    expect(stored?.created_by_auth_user_id).not.toBe(studentA.authUserId);
  });
});

// ---------------------------------------------------------------------------
// 4. Mark all read + sender-history privacy.

test.describe("Mark all read and sender history privacy", () => {
  const tracked: Phase18Identity[] = [];
  let adminA: Phase18Identity | undefined;
  let adminB: Phase18Identity | undefined;
  let student: Phase18Identity | undefined;
  const firstTitle = uniqueTitle("bulk one");
  const secondTitle = uniqueTitle("bulk two");

  test.beforeAll(async () => {
    if (skipSuite) return;
    adminA = await createTracked("admin", "HistoryA", tracked);
    adminB = await createTracked("admin", "HistoryB", tracked);
    student = await createTracked("student", "BulkReader", tracked);
    await sendNotificationAsAdmin({
      admin: adminA,
      recipient: student,
      title: firstTitle,
      body: "First unread message.",
    });
    await sendNotificationAsAdmin({
      admin: adminA,
      recipient: student,
      title: secondTitle,
      body: "Second unread message.",
    });
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await cleanup(tracked);
  });

  test("Mark all as read persists, and only the sending Admin sees the sent history", async ({
    page,
  }) => {
    if (!adminA || !adminB || !student) throw new Error("Fixture setup incomplete.");

    await login(page, student);
    await page.goto("/student/notifications");
    await expect(page.getByText("2 unread notifications", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Mark all as read" }).click();
    await expect(
      page.getByText("No unread notifications", { exact: true }),
    ).toBeVisible();
    await expect(
      inboxItem(page, firstTitle).getByText("Read", { exact: true }),
    ).toBeVisible();
    await expect(
      inboxItem(page, secondTitle).getByText("Read", { exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByText("No unread notifications", { exact: true }),
    ).toBeVisible();
    await expect(
      inboxItem(page, firstTitle).getByText("Read", { exact: true }),
    ).toBeVisible();
    await expect(
      inboxItem(page, secondTitle).getByText("Read", { exact: true }),
    ).toBeVisible();

    await switchUser(page, adminA);
    await page.goto("/admin/notifications");
    for (const title of [firstTitle, secondTitle]) {
      const row = sentItem(page, title);
      await expect(row).toBeVisible();
      await expect(row.getByText("Read by recipient", { exact: true })).toBeVisible();
    }

    await switchUser(page, adminB);
    await page.goto("/admin/notifications");
    await expect(
      page.getByText("You have not sent any notifications yet."),
    ).toBeVisible();
    await expect(page.getByText(firstTitle)).toHaveCount(0);
    await expect(page.getByText(secondTitle)).toHaveCount(0);
  });
});
