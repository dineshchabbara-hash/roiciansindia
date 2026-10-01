import { test, expect, type Page } from "@playwright/test";
import {
  hasRealSupabaseCredentials,
  createPhase12AdminIdentity,
  deletePhase12AdminIdentity,
  Phase12PartialAdminIdentityError,
  type Phase12AdminIdentity,
  createPhase12TrainerPortalIdentity,
  deletePhase12TrainerPortalIdentity,
  Phase12PartialTrainerPortalIdentityError,
  type Phase12TrainerPortalIdentity,
  createPhase12StudentPortalIdentity,
  deletePhase12StudentPortalIdentity,
  Phase12PartialStudentPortalIdentityError,
  type Phase12StudentPortalIdentity,
  findTwoExistingProgramsWithBatches,
  type ExistingProgramWithBatch,
  findEligibleStudentBatchPair,
  assignPhase12TrainerToBatch,
  deletePhase12BatchAssignmentIfSafe,
  createPhase12SyntheticEnrollment,
  deletePhase12SyntheticEnrollmentIfSafe,
  createPhase12ClassSessionDirect,
  deletePhase12ClassSessionIfSafe,
  type Phase12DeleteResult,
  RUN_ID,
  PHASE12_E2E_PREFIX,
} from "./support/phase12-fixtures";

/**
 * Phase 12 (Class Sessions) automated acceptance suite — run against a REAL
 * dev Supabase project via the actual running Next.js app, same precedent as
 * e2e/phase11-trainer-portal.spec.ts. Requires real dev credentials in
 * .env.local — skips itself cleanly otherwise.
 *
 * Covers task items A-P:
 *   A. Admin/Super Admin can reach Class Sessions.        (describe 1)
 *   B. Class Session list displays expected safe data.     (describe 1)
 *   C. Authorized Class Session detail works.               (describe 1)
 *   D. Authorized Class Session creation works.             (describe 1)
 *   E. Authorized Class Session edit works.                 (describe 1)
 *   F. Required validation rejects invalid session input.   (describe 1)
 *   G. Trainer can see sessions for an assigned Batch.       (describe 2)
 *   H. Trainer cannot see an unrelated Batch's Session.      (describe 2)
 *   I. Trainer cannot access unrelated Session by direct URL. (describe 2)
 *   J. Nonexistent Session ID is handled safely.             (describe 1 + 2)
 *   K. Student authorization per approved Phase 12 scope.    (describe 3)
 *   L. Anonymous user is denied.                             (describe 4)
 *   M. Role boundaries remain intact.                        (describe 2 + 3)
 *   N. Class Session pages do not expose financial data.     (describe 1)
 *   O. Phase 11 Trainer Portal remains functional.           (describe 2)
 *   P. Phase 10 Student Portal remains functional.           (describe 3)
 *
 * Cross-identity RLS isolation at the database layer (Admin/assigned
 * Trainer/unrelated Trainer/enrolled Student/unrelated Student/anon, both
 * allowed and denied) is covered separately by
 * supabase/tests/phase12_class_sessions_test.sql (run via
 * scripts/test-rls.sh, local scratch Postgres, never live data). This file
 * covers the APPLICATION's own behavior: real login, real create/edit forms,
 * real route protection, and the direct-URL/ID-manipulation defense on the
 * Class Session detail/edit routes.
 *
 * The Admin and Trainer describe blocks create every session they test
 * THROUGH the real application UI — this also exercises Phase 12's own
 * create/edit flows as part of proving D/E/G. Each such session's own id is
 * captured from the post-create redirect URL and tracked for cleanup, never
 * a bulk/date-range delete. The Student describe block instead creates its
 * own two precondition sessions directly (createPhase12ClassSessionDirect) —
 * it is only proving read-scoping, not creation, and critically must not
 * depend on the Trainer block's own session having run first: the Phase 12
 * acceptance protocol runs tests ONE AT A TIME via `-g`
 * (`npx playwright test ... -g "<test name>"`), under which a sibling
 * describe block's tests (and the side effects they'd otherwise create)
 * never execute at all — only the describe block containing the matched
 * test gets its own beforeAll/afterAll run. All sessions use a fixed,
 * clearly-future session date ("2099-01-01") so "upcoming classes" filtering
 * is deterministic regardless of which real day this suite runs.
 */

test.describe.configure({ mode: "serial" });

const skipSuite = !hasRealSupabaseCredentials();

test.skip(
  skipSuite,
  "Phase 12 live E2E suite requires real dev Supabase credentials in .env.local " +
    "(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Skipped, not failed: " +
    "this is expected in any environment without a live dev project configured.",
);

const FUTURE_SESSION_DATE = "2099-01-01";

async function login(page: Page, path: string, email: string, password: string) {
  await page.goto(path);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

// A plain toHaveURL(...) check after login()'s click is not sufficient: the
// sign-in Server Action's redirect() updates the browser's URL via Next's
// client router before the destination route's own server-side auth check
// (and the browser's cookie jar) have necessarily settled, so the URL
// assertion can pass on a request where the session hasn't actually
// persisted yet — e2e/phase5-student-management.spec.ts's own git history
// (commits cb4af96/0454bc8) diagnosed and fixed exactly this race for Admin
// login: the symptom there was identical to what reappeared here (a
// create-form page never rendering, with the server logging the same
// is_admin_or_super/current_trainer_id permission errors a genuinely
// unauthenticated request produces against those RLS-embedded functions).
// This file's login helpers predate that fix and never received it — each
// waits for the destination portal's own heading to actually render
// (Playwright's auto-retrying toBeVisible(), not a one-shot URL match) and
// for at least one sb-* auth cookie to be present (existence only, never a
// value) before any caller is allowed to navigate further.
async function assertSessionPersisted(page: Page) {
  const cookies = await page.context().cookies();
  expect(
    cookies.some((c) => c.name.startsWith("sb-")),
    "expected a persisted sb-* auth cookie after a successful login",
  ).toBe(true);
}

async function loginAsAdmin(page: Page, identity: Phase12AdminIdentity) {
  await login(page, "/login/admin", identity.email, identity.password);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

async function loginAsTrainer(page: Page, identity: Phase12TrainerPortalIdentity) {
  await login(page, "/login/trainer", identity.email, identity.password);
  await expect(page).toHaveURL(/\/trainer$/);
  await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

async function loginAsStudent(page: Page, identity: Phase12StudentPortalIdentity) {
  await login(page, "/login/student", identity.email, identity.password);
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

async function runCleanupSteps(
  steps: Array<{ label: string; run: () => Promise<Phase12DeleteResult> }>,
): Promise<void> {
  const failures: string[] = [];
  for (const step of steps) {
    const result = await step.run();
    if (!result.ok) {
      failures.push(`${step.label}: ${result.reason}`);
    }
  }
  expect(
    failures,
    failures.length > 0
      ? `One or more temporary records failed to clean up. These may still exist in ` +
          `the dev project — do NOT attempt automatic recovery or broaden deletion to ` +
          `any other record; verify by exact id only, and remove manually only after ` +
          `separate approval:\n${failures.join("\n")}`
      : undefined,
  ).toEqual([]);
}

// Gives a single test a Class Session it owns outright — created directly
// (service-role insert, same precedent as the Student describe block's own
// precondition rows) rather than via the real create UI, because for each
// caller below creation itself isn't what's under test (test (D) already
// independently proves Admin creation through the real UI) — only list
// rendering, editing, status changes, or the financial-field check are.
// Runs cleanup in a `finally` so it still happens if `run` throws/fails an
// assertion, and fails loudly (via `expect`, same convention as
// runCleanupSteps) rather than silently leaving the row behind.
async function withOwnClassSession<T>(
  input: { batchId: string; topic: string },
  run: (sessionId: string) => Promise<T>,
): Promise<T> {
  const sessionId = await createPhase12ClassSessionDirect({
    batchId: input.batchId,
    sessionDate: FUTURE_SESSION_DATE,
    topic: input.topic,
  });
  try {
    return await run(sessionId);
  } finally {
    const result = await deletePhase12ClassSessionIfSafe(sessionId);
    expect(
      result.ok,
      result.ok
        ? undefined
        : `Failed to clean up this test's own class session (id=${sessionId}, ` +
            `topic="${input.topic}"): ${result.reason}. This may still exist in the ` +
            `dev project — do NOT broaden deletion to any other record; remove ` +
            `manually by this exact id only, after separate approval.`,
    ).toBe(true);
  }
}

async function fillClassSessionForm(
  page: Page,
  input: { topic: string; startTime?: string; endTime?: string },
) {
  await page.locator("#sessionDate").fill(FUTURE_SESSION_DATE);
  if (input.startTime) await page.locator("#startTime").fill(input.startTime);
  if (input.endTime) await page.locator("#endTime").fill(input.endTime);
  await page.locator("#topic").fill(input.topic);
}

function sessionIdFromUrl(url: string): string {
  const match = url.match(/\/sessions\/([0-9a-f-]{36})(?:\/|$)/i);
  if (!match) throw new Error(`Could not extract a session id from URL: ${url}`);
  return match[1];
}

// ---------------------------------------------------------------------------
// (A/B/C/D/E/F/J/N) Admin — full Class Session management on a real batch.

test.describe("Admin — Class Session management", () => {
  let admin: Phase12AdminIdentity | undefined;
  let pairs: [ExistingProgramWithBatch, ExistingProgramWithBatch] | undefined;
  let adminSessionId: string | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      admin = await createPhase12AdminIdentity("Admin");
    } catch (err) {
      if (err instanceof Phase12PartialAdminIdentityError) admin = err.partial;
      throw err;
    }
    const found = await findTwoExistingProgramsWithBatches();
    if (!found) {
      throw new Error(
        "Fewer than two existing Batches were found in the dev project — Phase 12's " +
          "suite needs two distinct real (Program, Batch) pairs.",
      );
    }
    pairs = found;
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `admin's class session (id=${adminSessionId ?? "none"})`,
        run: () =>
          adminSessionId
            ? deletePhase12ClassSessionIfSafe(adminSessionId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `admin login identity (authUserId=${admin?.authUserId ?? "none"})`,
        run: () =>
          admin ? deletePhase12AdminIdentity(admin) : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("(A) Admin can reach the Class Sessions section for a batch", async ({ page }) => {
    if (!admin || !pairs) throw new Error("beforeAll did not fully set up.");
    await loginAsAdmin(page, admin);
    await page.goto(`/admin/batches/${pairs[0].batchId}`);
    // CardTitle renders a <div>, not a semantic heading element — scoped by
    // its own data-slot marker rather than an (absent) heading role.
    await expect(
      page.locator('[data-slot="card-title"]:text-is("Class Sessions")'),
    ).toBeVisible();
  });

  test("(F) The create form rejects an end time before the start time", async ({
    page,
  }) => {
    if (!admin || !pairs) throw new Error("beforeAll did not fully set up.");
    await loginAsAdmin(page, admin);
    await page.goto(`/admin/batches/${pairs[0].batchId}/sessions/new`);
    await fillClassSessionForm(page, {
      topic: "Phase12E2E Should Not Be Created",
      startTime: "11:00",
      endTime: "09:00",
    });
    await page.getByRole("button", { name: "Create session" }).click();
    await expect(page.getByText(/cannot be before the start time/i)).toBeVisible();
    // No navigation occurred — still on the create form, not a detail page.
    await expect(page).toHaveURL(/\/sessions\/new$/);
  });

  test("(D) Admin can create a class session", async ({ page }) => {
    if (!admin || !pairs) throw new Error("beforeAll did not fully set up.");
    await loginAsAdmin(page, admin);
    await page.goto(`/admin/batches/${pairs[0].batchId}/sessions/new`);
    await fillClassSessionForm(page, {
      topic: "Phase12E2E Admin Session",
      startTime: "09:00",
      endTime: "11:00",
    });
    await page.getByRole("button", { name: "Create session" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/admin/batches/${pairs[0].batchId}/sessions/[0-9a-f-]{36}$`),
    );
    adminSessionId = sessionIdFromUrl(page.url());
    console.log(`[phase12 e2e] admin session created: id=${adminSessionId}`);

    // (C) Detail page renders the just-created session's own fields. The
    // status is scoped to the badge specifically ([data-slot="badge"]) — the
    // Status card's <select> below it also renders a "Scheduled" option,
    // which Playwright's default case-insensitive substring getByText would
    // otherwise also match, a strict-mode violation of the exact shape
    // fixed repeatedly throughout Phase 9/10/11.
    await expect(
      page.getByRole("heading", { name: "Phase12E2E Admin Session" }),
    ).toBeVisible();
    await expect(page.locator('[data-slot="badge"]')).toHaveText("scheduled");
  });

  test("(B) The batch's Class Sessions list shows the created session", async ({
    page,
  }) => {
    if (!admin || !pairs) throw new Error("beforeAll did not fully set up.");
    const theAdmin = admin;
    const batchId = pairs[0].batchId;
    // Independently owned, not test (D)'s adminSessionId: this test's job is
    // list visibility, not creation (already proven by (D) through the real
    // UI) — see withOwnClassSession's own comment. Must still be runnable
    // alone via `-g`, so it cannot depend on (D) having run first.
    const topic = `${PHASE12_E2E_PREFIX} B List Session ${RUN_ID}`;
    await withOwnClassSession({ batchId, topic }, async (sessionId) => {
      await loginAsAdmin(page, theAdmin);
      await page.goto(`/admin/batches/${batchId}`);
      await expect(
        page.locator(`a[href="/admin/batches/${batchId}/sessions/${sessionId}"]`),
      ).toHaveText(topic);
    });
  });

  test("(E) Admin can edit a class session, and the change persists after reload", async ({
    page,
  }) => {
    if (!admin || !pairs) throw new Error("beforeAll did not fully set up.");
    const theAdmin = admin;
    const batchId = pairs[0].batchId;
    // Independently owned: this test's job is editing, not creation (already
    // proven by (D) through the real UI) — see withOwnClassSession's own
    // comment.
    const topic = `${PHASE12_E2E_PREFIX} E Edit Session ${RUN_ID}`;
    await withOwnClassSession({ batchId, topic }, async (sessionId) => {
      await loginAsAdmin(page, theAdmin);
      await page.goto(`/admin/batches/${batchId}/sessions/${sessionId}/edit`);
      await page.locator("#topic").fill("Phase12E2E Admin Session Edited");
      await page.getByRole("button", { name: "Save changes" }).click();

      await expect(page).toHaveURL(
        new RegExp(`/admin/batches/${batchId}/sessions/${sessionId}$`),
      );
      await expect(
        page.getByRole("heading", { name: "Phase12E2E Admin Session Edited" }),
      ).toBeVisible();

      // Durable proof via an independent reload, not just the post-redirect render.
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Phase12E2E Admin Session Edited" }),
      ).toBeVisible();
    });
  });

  test("Admin can change a class session's status, and it persists after reload", async ({
    page,
  }) => {
    if (!admin || !pairs) throw new Error("beforeAll did not fully set up.");
    const theAdmin = admin;
    const batchId = pairs[0].batchId;
    // Independently owned: this test's job is the status control, not
    // creation (already proven by (D) through the real UI) — see
    // withOwnClassSession's own comment.
    const topic = `${PHASE12_E2E_PREFIX} Status Session ${RUN_ID}`;
    await withOwnClassSession({ batchId, topic }, async (sessionId) => {
      await loginAsAdmin(page, theAdmin);
      await page.goto(`/admin/batches/${batchId}/sessions/${sessionId}`);
      await page.locator('select[name="status"]').selectOption("completed");
      await page.getByRole("button", { name: "Update status" }).click();
      await expect(page.getByText("Saved")).toBeVisible();

      await page.reload();
      await expect(page.locator('select[name="status"]')).toHaveValue("completed");
    });
  });

  test("(J) A nonexistent class session id 404s", async ({ page }) => {
    if (!admin || !pairs) throw new Error("beforeAll did not fully set up.");
    await loginAsAdmin(page, admin);
    const response = await page.goto(
      `/admin/batches/${pairs[0].batchId}/sessions/00000000-0000-0000-0000-000000000000`,
    );
    expect(response?.status()).toBe(404);
  });

  test("(N) Class Session pages never render financial fields or values", async ({
    page,
  }) => {
    if (!admin || !pairs) throw new Error("beforeAll did not fully set up.");
    const theAdmin = admin;
    const batchId = pairs[0].batchId;
    // Independently owned: this test's job is the financial-leakage check,
    // not creation (already proven by (D) through the real UI) — see
    // withOwnClassSession's own comment. Still needs a real session id to
    // reach the detail/edit pages below.
    const topic = `${PHASE12_E2E_PREFIX} N Financial Session ${RUN_ID}`;
    await withOwnClassSession({ batchId, topic }, async (sessionId) => {
      await loginAsAdmin(page, theAdmin);

      const forbiddenLabels = [
        "Total payable",
        "Outstanding",
        "Registration fee",
        "Regular fee",
        "Agreed fee",
        "Discount",
        "Refund",
        "Tax rate",
      ];
      const pagesToCheck = [
        `/admin/batches/${batchId}`,
        `/admin/batches/${batchId}/sessions/${sessionId}`,
        `/admin/batches/${batchId}/sessions/${sessionId}/edit`,
        `/admin/batches/${batchId}/sessions/new`,
      ];
      for (const path of pagesToCheck) {
        await page.goto(path);
        const bodyText = (await page.locator("body").innerText()) ?? "";
        for (const label of forbiddenLabels) {
          expect(
            bodyText.includes(label),
            `Unexpected financial label "${label}" rendered on ${path}`,
          ).toBe(false);
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// (G/H/I/J/M/O) Trainer — assigned-batch-only Class Session access.

test.describe("Trainer — assigned-batch-only Class Session access", () => {
  let trainerA: Phase12TrainerPortalIdentity | undefined;
  let trainerB: Phase12TrainerPortalIdentity | undefined;
  let pairs: [ExistingProgramWithBatch, ExistingProgramWithBatch] | undefined;
  let assignmentAId: string | undefined;
  let assignmentBId: string | undefined;
  let trainerASessionId: string | undefined;
  let trainerBSessionId: string | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      trainerA = await createPhase12TrainerPortalIdentity("ScopeA");
    } catch (err) {
      if (err instanceof Phase12PartialTrainerPortalIdentityError) trainerA = err.partial;
      throw err;
    }
    try {
      trainerB = await createPhase12TrainerPortalIdentity("ScopeB");
    } catch (err) {
      if (err instanceof Phase12PartialTrainerPortalIdentityError) trainerB = err.partial;
      throw err;
    }

    const found = await findTwoExistingProgramsWithBatches();
    if (!found) throw new Error("Fewer than two existing Batches were found.");
    pairs = found;
    if (!trainerA.trainerId || !trainerB.trainerId) {
      throw new Error("beforeAll did not fully create both Trainer identities.");
    }
    assignmentAId = await assignPhase12TrainerToBatch(
      trainerA.trainerId,
      pairs[0].batchId,
    );
    assignmentBId = await assignPhase12TrainerToBatch(
      trainerB.trainerId,
      pairs[1].batchId,
    );
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `trainer A's class session (id=${trainerASessionId ?? "none"})`,
        run: () =>
          trainerASessionId
            ? deletePhase12ClassSessionIfSafe(trainerASessionId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `trainer B's class session (id=${trainerBSessionId ?? "none"})`,
        run: () =>
          trainerBSessionId
            ? deletePhase12ClassSessionIfSafe(trainerBSessionId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `batch assignment A (id=${assignmentAId ?? "none"})`,
        run: () =>
          assignmentAId
            ? deletePhase12BatchAssignmentIfSafe(assignmentAId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `batch assignment B (id=${assignmentBId ?? "none"})`,
        run: () =>
          assignmentBId
            ? deletePhase12BatchAssignmentIfSafe(assignmentBId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `trainer A portal identity (authUserId=${trainerA?.authUserId ?? "none"})`,
        run: () =>
          trainerA
            ? deletePhase12TrainerPortalIdentity(trainerA)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `trainer B portal identity (authUserId=${trainerB?.authUserId ?? "none"})`,
        run: () =>
          trainerB
            ? deletePhase12TrainerPortalIdentity(trainerB)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("(G) Trainer can create and see a session for their own assigned batch", async ({
    page,
  }) => {
    if (!trainerA || !pairs) throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainerA);
    await page.goto(`/trainer/batches/${pairs[0].batchId}/sessions/new`);
    await fillClassSessionForm(page, {
      topic: "Phase12E2E TrainerA Session",
      startTime: "09:00",
      endTime: "11:00",
    });
    await page.getByRole("button", { name: "Create session" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/trainer/batches/${pairs[0].batchId}/sessions/[0-9a-f-]{36}$`),
    );
    trainerASessionId = sessionIdFromUrl(page.url());
    console.log(`[phase12 e2e] trainer A session created: id=${trainerASessionId}`);

    await page.goto(`/trainer/batches/${pairs[0].batchId}`);
    await expect(
      page.locator(
        `a[href="/trainer/batches/${pairs[0].batchId}/sessions/${trainerASessionId}"]`,
      ),
    ).toHaveText("Phase12E2E TrainerA Session");

    // (O) Phase 11's own Students section on this same batch detail page
    // remains intact alongside the new Class Sessions section.
    await expect(
      page.getByRole("heading", { name: "Students in this batch" }),
    ).toBeVisible();
  });

  test("sets up Trainer B's own session for the cross-batch isolation checks", async ({
    page,
  }) => {
    if (!trainerB || !pairs) throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainerB);
    await page.goto(`/trainer/batches/${pairs[1].batchId}/sessions/new`);
    await fillClassSessionForm(page, { topic: "Phase12E2E TrainerB Session" });
    await page.getByRole("button", { name: "Create session" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/trainer/batches/${pairs[1].batchId}/sessions/[0-9a-f-]{36}$`),
    );
    trainerBSessionId = sessionIdFromUrl(page.url());
    console.log(`[phase12 e2e] trainer B session created: id=${trainerBSessionId}`);
  });

  test("(H/I) Trainer A cannot view Trainer B's session via direct URL/ID manipulation", async ({
    page,
  }) => {
    if (!trainerA || !pairs) throw new Error("beforeAll did not fully set up.");
    const theTrainerA = trainerA;
    // Independently owned, not the sibling "sets up Trainer B's own
    // session..." test's trainerBSessionId: that variable is only ever
    // assigned inside that test's own body, so running (H/I) alone via `-g`
    // (sibling tests in the same describe block never execute) always found
    // it unset. This test's purpose is the cross-trainer/cross-batch denial,
    // not proving Trainer B's own create flow (already covered by the
    // sibling test, and by (G) for Trainer A) — so a direct-insert session is
    // the right setup here, same precedent as the Admin describe block's own
    // isolation fix (withOwnClassSession).
    //
    // "Belongs to Trainer B's own Batch" and "Trainer A is unrelated to that
    // Batch" both hold by construction, not by assertion: this session is
    // inserted on pairs[1].batchId, the exact batch beforeAll assigned to
    // Trainer B (assignPhase12TrainerToBatch(trainerB.trainerId,
    // pairs[1].batchId)) — never Trainer A — and pairs[1] is guaranteed
    // distinct from pairs[0] (Trainer A's own assigned batch) by
    // findTwoExistingProgramsWithBatches. Trainer A was never used to create
    // it.
    const trainerBBatchId = pairs[1].batchId;
    const topic = `${PHASE12_E2E_PREFIX} HI TrainerB Session ${RUN_ID}`;
    await withOwnClassSession(
      { batchId: trainerBBatchId, topic },
      async (trainerBSessionId) => {
        await loginAsTrainer(page, theTrainerA);

        // getMySession (lib/data/trainer-portal.ts) first verifies the batch
        // is one of the caller's own assignments via getMyBatch — Trainer
        // B's real, genuinely-existing batch/session must come back as a
        // plain 404.
        const response = await page.goto(
          `/trainer/batches/${trainerBBatchId}/sessions/${trainerBSessionId}`,
        );
        expect(response?.status()).toBe(404);
        await expect(page.getByText(topic)).toHaveCount(0);
      },
    );
  });

  test("(J) A nonexistent class session id 404s for a Trainer too", async ({ page }) => {
    if (!trainerA || !pairs) throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainerA);
    const response = await page.goto(
      `/trainer/batches/${pairs[0].batchId}/sessions/00000000-0000-0000-0000-000000000000`,
    );
    expect(response?.status()).toBe(404);
  });

  test("(M) Trainer is blocked from the Admin Class Session create route", async ({
    page,
  }) => {
    if (!trainerA || !pairs) throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainerA);
    await page.goto(`/admin/batches/${pairs[0].batchId}/sessions/new`);
    // Same anchored-path fix established throughout Phase 10/11 for every
    // cross-portal denial check in this suite.
    await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/admin(?:\/|$)/);
  });
});

// ---------------------------------------------------------------------------
// (K/M/P) Student — dashboard-only Class Session visibility, and the Phase
// 10 Student Portal regression spot-check.

test.describe("Student — dashboard-only Class Session visibility", () => {
  let student: Phase12StudentPortalIdentity | undefined;
  let ownBatch: ExistingProgramWithBatch | undefined;
  let unrelatedBatch: ExistingProgramWithBatch | undefined;
  let enrollmentId: string | undefined;
  let ownBatchSessionId: string | undefined;
  let unrelatedBatchSessionId: string | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      student = await createPhase12StudentPortalIdentity("Dashboard");
    } catch (err) {
      if (err instanceof Phase12PartialStudentPortalIdentityError) student = err.partial;
      throw err;
    }
    // Deliberately NOT findTwoExistingProgramsWithBatches (the plain
    // "first two batches by id" lookup the Admin/Trainer blocks use) — see
    // findEligibleStudentBatchPair's own doc comment: a real, actively used
    // dev batch can already carry 5+ real 'scheduled' future-dated sessions
    // of its own, and getMyUpcomingClassSessions hard-limits to 5 ordered by
    // date ascending, so a single additional synthetic row — however far in
    // the future it's dated — is not guaranteed a slot in that window. This
    // was the actual remaining cause of test (K) failing even after the
    // cross-describe-block isolation fix: the chosen batch ("QA Demo 2" in
    // the dev project) already had enough real upcoming sessions to crowd
    // out a row dated 2099-01-01. findEligibleStudentBatchPair picks a batch
    // with fewer than 5 existing such rows instead, guaranteeing room,
    // without touching any real/legitimate dev data.
    const found = await findEligibleStudentBatchPair();
    if (!found) {
      throw new Error(
        "Could not find a Batch with room under the Upcoming-classes widget's limit(5) " +
          "among the first 50 existing Batches in the dev project.",
      );
    }
    ownBatch = found.ownBatch;
    unrelatedBatch = found.unrelatedBatch;
    if (!student.studentId) {
      throw new Error("beforeAll did not fully create the Student identity.");
    }
    enrollmentId = await createPhase12SyntheticEnrollment({
      studentId: student.studentId,
      programId: ownBatch.programId,
      batchId: ownBatch.batchId,
      agreedFeeRupees: 15000,
    });

    // Self-contained precondition rows (see this file's own header comment
    // for why these are NOT the Trainer describe block's UI-created
    // sessions): one 'scheduled', future-dated session on the Student's own
    // enrolled batch (now guaranteed room within the widget's limit(5) by
    // findEligibleStudentBatchPair above), and one on a genuinely unrelated
    // batch the Student has no enrollment in at all — giving the negative
    // isolation check in (K) a real competing row to prove isolation
    // against, not a vacuous absence.
    ownBatchSessionId = await createPhase12ClassSessionDirect({
      batchId: ownBatch.batchId,
      sessionDate: FUTURE_SESSION_DATE,
    });
    unrelatedBatchSessionId = await createPhase12ClassSessionDirect({
      batchId: unrelatedBatch.batchId,
      sessionDate: FUTURE_SESSION_DATE,
    });
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `student's own-batch class session (id=${ownBatchSessionId ?? "none"})`,
        run: () =>
          ownBatchSessionId
            ? deletePhase12ClassSessionIfSafe(ownBatchSessionId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `unrelated-batch class session (id=${unrelatedBatchSessionId ?? "none"})`,
        run: () =>
          unrelatedBatchSessionId
            ? deletePhase12ClassSessionIfSafe(unrelatedBatchSessionId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `student's enrollment (id=${enrollmentId ?? "none"})`,
        run: () =>
          enrollmentId
            ? deletePhase12SyntheticEnrollmentIfSafe(enrollmentId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `student portal identity (authUserId=${student?.authUserId ?? "none"})`,
        run: () =>
          student
            ? deletePhase12StudentPortalIdentity(student)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("(P) Student can still log in and reach the Student Portal dashboard", async ({
    page,
  }) => {
    if (!student) throw new Error("beforeAll did not create the Student identity.");
    await loginAsStudent(page, student);
    await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  });

  test("(K) Student sees their own enrolled batch's upcoming class on the dashboard, never an unrelated batch's", async ({
    page,
  }) => {
    if (!student || !ownBatch || !unrelatedBatch) {
      throw new Error("beforeAll did not fully set up.");
    }
    await loginAsStudent(page, student);
    // No page.goto("/student") and no page.reload() here. Both were tried in
    // earlier rounds of this fix and both left test (K) failing; live
    // Supabase edge_logs for the actual runs (captured directly from the dev
    // project, not inferred) showed why neither extra navigation was ever
    // the right tool: the fixture's own class_sessions rows are inserted via
    // a plain `await` service-role POST in beforeAll — e.g. a captured run's
    // POST .../rest/v1/class_sessions (201) at 16:00:07.937/08.677, strictly
    // before that same run's POST .../auth/v1/token login at 16:00:10.110 —
    // so by the time loginAsStudent's redirect lands on /student, the data
    // this test asserts on is already committed. force-dynamic on
    // app/student/page.tsx then guarantees that very first post-login render
    // is a fresh, uncached server round-trip (the same run's own
    // GET .../rest/v1/class_sessions?...&limit=5 at 16:00:12.276 is that
    // round-trip, already after the commit). A second navigation is not
    // just unnecessary — a reload() captured for this exact test produced no
    // additional REST traffic to Supabase at all in the run's logs (no
    // second auth/class_sessions/students/enrollments/payments burst between
    // login and this describe block's cleanup), so it was asserting against
    // an unverified, possibly-unrefreshed page rather than adding safety.
    // Asserting directly off the post-login render matches test (P) immediately
    // above, which has passed throughout every round of this fix.

    // Fails loudly with the real error text if the data layer itself
    // errored, rather than leaving only an opaque "element not found" —
    // getMyUpcomingClassSessions (lib/data/student-portal.ts) surfaces a
    // failure as a role="alert" element in this exact card.
    const upcomingCard = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]:text-is("Upcoming classes")'),
    });
    await expect(upcomingCard.getByRole("alert")).toHaveCount(0);

    // The Upcoming-classes widget (lib/data/student-portal.ts's
    // getMyUpcomingClassSessions, mirroring the pre-existing Admin dashboard
    // widget's own shape) shows batch/program name, not session topic — it
    // picks up this describe block's own still-'scheduled' session on
    // ownBatch (created directly in beforeAll — see this file's header
    // comment for why it is not the Trainer describe block's UI-created
    // session, and findEligibleStudentBatchPair's own comment for why this
    // batch, specifically, is guaranteed room within the widget's limit(5)).
    // ownBatch.batchName also legitimately appears a second time on this
    // page, in this Student's own StudentEnrollmentCard ("Batch" field) — so
    // the positive assertion is scoped to the Upcoming-classes card
    // specifically, the same card-scoping-by-marker pattern established
    // throughout Phase 9/10/11 rather than an arbitrary .first()/.last().
    await expect(
      upcomingCard.getByText(ownBatch.batchName, { exact: true }),
    ).toBeVisible();
    // unrelatedBatch (this describe block's own beforeAll also created a
    // real 'scheduled' session for it, but the Student has no enrollment
    // there at all) must never appear anywhere on this Student's own
    // dashboard — unlike ownBatch, this one has no other legitimate reason
    // to render here, so the page-wide zero-count check is unambiguous, and
    // it is proven against a genuinely existing competing row, not a vacuous
    // absence.
    await expect(page.getByText(unrelatedBatch.batchName, { exact: true })).toHaveCount(
      0,
    );
  });

  test("(M) Student is blocked from the Trainer Class Session create route", async ({
    page,
  }) => {
    if (!student || !ownBatch) throw new Error("beforeAll did not fully set up.");
    await loginAsStudent(page, student);
    await page.goto(`/trainer/batches/${ownBatch.batchId}/sessions/new`);
    await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/trainer(?:\/|$)/);
  });
});

// ---------------------------------------------------------------------------
// (L) Anonymous authorization — no fixture needed at all. Uses a batch id
// that doesn't even need to be real: the layout's own auth gate redirects
// before any batch/session lookup ever runs.

test.describe("Anonymous authorization: Class Sessions", () => {
  test("anonymous is redirected away from Admin and Trainer Class Session routes", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/admin/batches/00000000-0000-0000-0000-000000000000/sessions/new");
    await expect(page).toHaveURL(/\/login\/admin$/);

    await page.goto("/trainer/batches/00000000-0000-0000-0000-000000000000/sessions/new");
    await expect(page).toHaveURL(/\/login\/trainer$/);
  });
});
