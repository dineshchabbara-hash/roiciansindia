import { test, expect, type Page } from "@playwright/test";
import {
  hasRealSupabaseCredentials,
  createPhase16AdminIdentity,
  deletePhase16AdminIdentity,
  Phase16PartialAdminIdentityError,
  type Phase16AdminIdentity,
  createPhase16TrainerPortalIdentity,
  deletePhase16TrainerPortalIdentity,
  Phase16PartialTrainerPortalIdentityError,
  type Phase16TrainerPortalIdentity,
  createPhase16StudentPortalIdentity,
  deletePhase16StudentPortalIdentity,
  Phase16PartialStudentPortalIdentityError,
  type Phase16StudentPortalIdentity,
  findExistingProgramWithBatch,
  type ExistingProgramWithBatch,
  assignPhase16TrainerToBatch,
  deletePhase16BatchAssignmentIfSafe,
  createPhase16SyntheticEnrollment,
  deletePhase16SyntheticEnrollmentIfSafe,
  createPhase16AssignmentDirect,
  deletePhase16AssignmentIfExists,
  deletePhase16AssignmentByTitleIfExists,
  buildPhase16FixtureAttachmentPdf,
  PHASE16_E2E_PREFIX,
  RUN_ID,
  type Phase16DeleteResult,
} from "./support/phase16-fixtures";

/**
 * Phase 16 (Assignments & Submissions) automated acceptance suite — run
 * against a REAL dev Supabase project via the actual running Next.js app,
 * same precedent as e2e/phase15-materials.spec.ts.  Requires real dev
 * credentials in .env.local — skips itself cleanly otherwise.
 *
 * Requirement → Test mapping (REQUIREMENTS.md FR-80/81/82,
 * IMPLEMENTATION_PLAN.md Phase 16):
 *   A. Admin creates an authorized Batch assignment, with an attachment,
 *      bound to a trainer actually assigned to that batch; it appears in
 *      the list and the attachment opens via a working signed URL.
 *                                                                (describe 1)
 *   B. Instructions/due date persist — asserted as part of test A (the
 *      created row's own summary line shows the due date; the description
 *      is asserted in the expanded detail).                     (describe 1)
 *   C. Admin sees submission status/details — covered by
 *      supabase/tests/phase16_assignments_test.sql's own
 *      assignment_submissions_select_admin assertions and by the
 *      SubmissionReviewForm/SubmissionsSection code paths being exercised
 *      at the unit/SQL layer; the review UI itself (marks/feedback form)
 *      is simple, declarative, server-action-bound markup with its own
 *      authorization fully proven at the SQL layer — not independently
 *      re-driven through a browser here, same economizing the Phase 15
 *      suite itself documents for several of its own non-UI-novel items.
 *   D. Assigned Trainer creates/manages an assignment for their own
 *      assigned Batch, with an optional Module tag.              (describe 2)
 *   E. Trainer cannot create for an unrelated Batch — TrainerCreateAssignmentForm
 *      is only ever rendered bound to the Trainer's own assigned Batch (no
 *      batch picker exists in the UI at all), and the server action
 *      independently re-verifies via getMyBatch; the direct-tampering case
 *      (a crafted batchId) is covered by
 *      supabase/tests/phase16_assignments_test.sql's own trainer-write
 *      denial assertions, not re-tested here.
 *   F. Trainer can view assigned Student submission / G. Trainer cannot
 *      view unrelated Student/Batch submission — fully covered by
 *      supabase/tests/phase16_assignments_test.sql's own
 *      assignment_submissions_select_trainer assertions (both the allowed
 *      and denied branch), not re-tested through the browser.
 *   H. Student sees own authorized assignment/due date, I. uploads own
 *      submission file, J. sees own submission state.            (describe 3)
 *   K. Student cannot see/modify another Student's submission / L. Student
 *      cannot access an unrelated assignment — fully covered by
 *      supabase/tests/phase16_assignments_test.sql's own
 *      assignment_submissions_select_own/write_own/update_own denial
 *      assertions (including the exact ownership-spoofing shapes
 *      20260101000028 closes), not re-tested through the browser.
 *   M. Anonymous denied / N. Student cannot use Admin/Trainer routes —
 *      Assignments adds no new route of its own whatsoever (every
 *      Assignments UI lives inside an already-existing Batch/Enrollment
 *      detail page), so route-level denial is already fully covered by
 *      Phase 8/10/11's own existing E2E suites, not re-tested here.
 *   O/P/Q. Student/Trainer Portal regression, no Trainer finance exposure
 *      — proven by re-running those phases' own existing suites during
 *      manual acceptance, not a new Phase 16 test.
 *
 * Every describe block owns its own Admin/Trainer/Student identity, its own
 * (program, batch) pair lookup, and its own synthetic Enrollment/Assignment
 * rows — none depend on another describe block's beforeAll, since the
 * acceptance protocol runs tests ONE AT A TIME via `-g`
 * (`npx playwright test ... -g "<test name>"`), under which a sibling
 * describe block's beforeAll never runs at all. Every real Program/Batch
 * used is only ever READ (findExistingProgramWithBatch), never mutated or
 * deleted — only new, synthetic child rows (Enrollment/Assignment/
 * batch_trainers) are created and exact-id cleaned up.
 */

test.describe.configure({ mode: "serial" });

const skipSuite = !hasRealSupabaseCredentials();

test.skip(
  skipSuite,
  "Phase 16 live E2E suite requires real dev Supabase credentials in .env.local " +
    "(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Skipped, not failed: " +
    "this is expected in any environment without a live dev project configured.",
);

async function login(page: Page, path: string, email: string, password: string) {
  await page.goto(path);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function assertSessionPersisted(page: Page) {
  const cookies = await page.context().cookies();
  expect(
    cookies.some((c) => c.name.startsWith("sb-")),
    "expected a persisted sb-* auth cookie after a successful login",
  ).toBe(true);
}

async function loginAsAdmin(page: Page, identity: Phase16AdminIdentity) {
  await login(page, "/login/admin", identity.email, identity.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

async function loginAsTrainer(page: Page, identity: Phase16TrainerPortalIdentity) {
  await login(page, "/login/trainer", identity.email, identity.password);
  await expect(page).toHaveURL(/\/trainer$/);
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

async function loginAsStudent(page: Page, identity: Phase16StudentPortalIdentity) {
  await login(page, "/login/student", identity.email, identity.password);
  await expect(page).toHaveURL(/\/student$/);
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

// "Assignments" is a shadcn CardTitle (a plain div, no ARIA heading role) —
// same scoped-card idiom as e2e/phase15-materials.spec.ts's own
// materialsCardOn, for the identical reason (never match Next's own
// always-present route-announcer element via an unscoped getByRole("alert")).
function assignmentsCardOn(page: Page) {
  return page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]:text-is("Assignments")'),
  });
}

function assignmentRow(card: ReturnType<typeof assignmentsCardOn>, title: string) {
  return card
    .locator("li")
    .filter({ has: card.page().getByText(title, { exact: true }) });
}

async function runCleanupSteps(
  steps: Array<{ label: string; run: () => Promise<Phase16DeleteResult> }>,
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

// Verifies a signed Storage URL independently of the popup's own navigation
// lifecycle — see e2e/phase15-materials.spec.ts's own
// clickViewAndVerifySignedFile for the full root-cause history (Chromium's
// PDF-viewer handoff aborting load-lifecycle tracking; response.body()
// being unreliable for navigation responses specifically) this helper
// carries forward verbatim, generalized to either assignment bucket.
async function clickViewAndVerifySignedFile(
  page: Page,
  viewButton: ReturnType<Page["getByRole"]>,
  bucket: "assignment-attachments" | "assignment-submissions",
  expectedBytes: Buffer,
) {
  const popupPromise = page.waitForEvent("popup");
  await viewButton.click();
  const popup = await popupPromise;

  const response = await popup.waitForEvent("response", {
    predicate: (r) => r.url().includes(`/storage/v1/object/sign/${bucket}/`),
    timeout: 15000,
  });
  const url = response.url();
  expect(response.status(), `signed URL request failed: ${url}`).toBe(200);
  expect(response.headers()["content-type"] ?? "").toContain("application/pdf");

  const verification = await page.request.get(url);
  expect(verification.ok(), `independent re-fetch of the signed URL failed: ${url}`).toBe(
    true,
  );
  const body = await verification.body();
  expect(
    body.equals(expectedBytes),
    "signed URL did not serve the exact uploaded file bytes",
  ).toBe(true);

  await popup.close().catch(() => {});
  return url;
}

// ---------------------------------------------------------------------------
// (A/B) Admin — Assignment creation with an attachment.

test.describe("Admin — Assignment management", () => {
  let admin: Phase16AdminIdentity | undefined;
  let trainer: Phase16TrainerPortalIdentity | undefined;
  let pair: ExistingProgramWithBatch | undefined;
  let batchTrainerId: string | undefined;
  const assignmentTitle = `${PHASE16_E2E_PREFIX} Admin Assignment ${RUN_ID}`;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      admin = await createPhase16AdminIdentity("Admin");
    } catch (err) {
      if (err instanceof Phase16PartialAdminIdentityError) admin = err.partial;
      throw err;
    }
    try {
      trainer = await createPhase16TrainerPortalIdentity("ForAdmin");
    } catch (err) {
      if (err instanceof Phase16PartialTrainerPortalIdentityError) trainer = err.partial;
      throw err;
    }
    const found = await findExistingProgramWithBatch();
    if (!found) throw new Error("No existing Batch was found in the dev project.");
    pair = found;
    if (trainer.trainerId) {
      batchTrainerId = await assignPhase16TrainerToBatch(trainer.trainerId, pair.batchId);
    }
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `Assignment ("${assignmentTitle}")`,
        run: () =>
          pair
            ? deletePhase16AssignmentByTitleIfExists(pair.batchId, assignmentTitle)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Trainer's batch assignment",
        run: () =>
          batchTrainerId
            ? deletePhase16BatchAssignmentIfSafe(batchTrainerId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Admin identity",
        run: () =>
          admin ? deletePhase16AdminIdentity(admin) : Promise.resolve({ ok: true }),
      },
      {
        label: "Trainer identity",
        run: () =>
          trainer
            ? deletePhase16TrainerPortalIdentity(trainer)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("Admin creates a Batch assignment with an attachment, and it appears with its due date and a working attachment link", async ({
    page,
  }) => {
    if (!admin || !pair || !trainer?.trainerId)
      throw new Error("Fixture setup incomplete.");

    await loginAsAdmin(page, admin);
    await page.goto(`/admin/batches/${pair.batchId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const card = assignmentsCardOn(page);
    await expect(card).toBeVisible();

    await card.locator('input[name="title"]').fill(assignmentTitle);
    await card.locator('input[name="description"]').fill("Write a 500-word essay.");
    await card.locator('select[name="trainerId"]').selectOption(trainer.trainerId);
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await card.locator('input[name="dueDate"]').fill(dueDate);

    const fileInput = card.locator('input[name="file"]');
    await fileInput.setInputFiles({
      name: "syllabus.pdf",
      mimeType: "application/pdf",
      buffer: buildPhase16FixtureAttachmentPdf(),
    });

    await card.getByRole("button", { name: "Create assignment" }).click();
    await Promise.race([
      card.getByRole("alert").waitFor({ state: "visible" }),
      card.getByText("Assignment created", { exact: true }).waitFor({ state: "visible" }),
    ]);
    await expect(card.getByRole("alert")).toHaveCount(0);

    const row = assignmentRow(card, assignmentTitle);
    await expect(row).toBeVisible();
    await expect(row).toContainText(dueDate);

    await row.locator("summary").click();
    await expect(row.getByText("Write a 500-word essay.")).toBeVisible();

    const viewButton = row.getByRole("button", { name: /View|syllabus\.pdf/ });
    await clickViewAndVerifySignedFile(
      page,
      viewButton,
      "assignment-attachments",
      buildPhase16FixtureAttachmentPdf(),
    );
  });
});

// ---------------------------------------------------------------------------
// (D) Trainer — Assignment creation on their own assigned Batch.

test.describe("Trainer — Assignment management", () => {
  let trainer: Phase16TrainerPortalIdentity | undefined;
  let pair: ExistingProgramWithBatch | undefined;
  let batchTrainerId: string | undefined;
  const assignmentTitle = `${PHASE16_E2E_PREFIX} Trainer Assignment ${RUN_ID}`;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      trainer = await createPhase16TrainerPortalIdentity("Owner");
    } catch (err) {
      if (err instanceof Phase16PartialTrainerPortalIdentityError) trainer = err.partial;
      throw err;
    }
    const found = await findExistingProgramWithBatch();
    if (!found) throw new Error("No existing Batch was found in the dev project.");
    pair = found;
    if (trainer.trainerId) {
      batchTrainerId = await assignPhase16TrainerToBatch(trainer.trainerId, pair.batchId);
    }
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `Assignment ("${assignmentTitle}")`,
        run: () =>
          pair
            ? deletePhase16AssignmentByTitleIfExists(pair.batchId, assignmentTitle)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Trainer's batch assignment",
        run: () =>
          batchTrainerId
            ? deletePhase16BatchAssignmentIfSafe(batchTrainerId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Trainer identity",
        run: () =>
          trainer
            ? deletePhase16TrainerPortalIdentity(trainer)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("Assigned Trainer creates an assignment (no file) on their own Batch, and it appears", async ({
    page,
  }) => {
    if (!trainer || !pair) throw new Error("Fixture setup incomplete.");

    await loginAsTrainer(page, trainer);
    await page.goto(`/trainer/batches/${pair.batchId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const card = assignmentsCardOn(page);
    await expect(card).toBeVisible();

    await card.locator('input[name="title"]').fill(assignmentTitle);
    const dueDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await card.locator('input[name="dueDate"]').fill(dueDate);

    await card.getByRole("button", { name: "Create assignment" }).click();
    await Promise.race([
      card.getByRole("alert").waitFor({ state: "visible" }),
      card.getByText("Assignment created", { exact: true }).waitFor({ state: "visible" }),
    ]);
    await expect(card.getByRole("alert")).toHaveCount(0);

    const row = assignmentRow(card, assignmentTitle);
    await expect(row).toBeVisible();
    await expect(row).toContainText(dueDate);
  });
});

// ---------------------------------------------------------------------------
// (H/I/J) Student — Assignment visibility and submission.

test.describe("Student — Assignment submission", () => {
  let trainer: Phase16TrainerPortalIdentity | undefined;
  let student: Phase16StudentPortalIdentity | undefined;
  let pair: ExistingProgramWithBatch | undefined;
  let batchTrainerId: string | undefined;
  let enrollmentId: string | undefined;
  let assignmentId: string | undefined;
  const assignmentTitle = `${PHASE16_E2E_PREFIX} Student-Visible Assignment ${RUN_ID}`;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      trainer = await createPhase16TrainerPortalIdentity("ForStudent");
    } catch (err) {
      if (err instanceof Phase16PartialTrainerPortalIdentityError) trainer = err.partial;
      throw err;
    }
    try {
      student = await createPhase16StudentPortalIdentity("Submitter");
    } catch (err) {
      if (err instanceof Phase16PartialStudentPortalIdentityError) student = err.partial;
      throw err;
    }
    const found = await findExistingProgramWithBatch();
    if (!found) throw new Error("No existing Batch was found in the dev project.");
    pair = found;
    if (trainer.trainerId) {
      batchTrainerId = await assignPhase16TrainerToBatch(trainer.trainerId, pair.batchId);
    }
    if (student.studentId) {
      enrollmentId = await createPhase16SyntheticEnrollment({
        studentId: student.studentId,
        programId: pair.programId,
        batchId: pair.batchId,
        agreedFeeRupees: 1000,
      });
    }
    if (trainer.trainerId) {
      assignmentId = await createPhase16AssignmentDirect({
        programId: pair.programId,
        batchId: pair.batchId,
        trainerId: trainer.trainerId,
        title: assignmentTitle,
        dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
      });
    }
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: "Assignment (direct fixture)",
        run: () =>
          assignmentId
            ? deletePhase16AssignmentIfExists(assignmentId, null)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Student's enrollment",
        run: () =>
          enrollmentId
            ? deletePhase16SyntheticEnrollmentIfSafe(enrollmentId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Trainer's batch assignment",
        run: () =>
          batchTrainerId
            ? deletePhase16BatchAssignmentIfSafe(batchTrainerId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Trainer identity",
        run: () =>
          trainer
            ? deletePhase16TrainerPortalIdentity(trainer)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Student identity",
        run: () =>
          student
            ? deletePhase16StudentPortalIdentity(student)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("Student sees their own enrolled-batch assignment, submits a text response and file, and can re-view their own file", async ({
    page,
  }) => {
    if (!student || !enrollmentId || !assignmentId)
      throw new Error("Fixture setup incomplete.");

    await loginAsStudent(page, student);
    await page.goto(`/student/enrollments/${enrollmentId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const card = assignmentsCardOn(page);
    await expect(card).toBeVisible();

    const row = assignmentRow(card, assignmentTitle);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Not submitted");

    await row.locator("summary").click();
    await row.locator('textarea[name="textResponse"]').fill("My submitted answer.");
    await row.locator('input[name="file"]').setInputFiles({
      name: "answer.pdf",
      mimeType: "application/pdf",
      buffer: buildPhase16FixtureAttachmentPdf(),
    });
    await row.getByRole("button", { name: "Submit" }).click();

    await Promise.race([
      row.getByRole("alert").waitFor({ state: "visible" }),
      row.getByText("Submitted", { exact: true }).waitFor({ state: "visible" }),
    ]);
    await expect(row.getByRole("alert")).toHaveCount(0);

    // Reload to see the persisted status reflected in the summary line
    // (the form's own inline "Submitted" success message is transient
    // client state, not the real server-backed status this assertion
    // needs).
    await page.reload();
    const reloadedRow = assignmentRow(assignmentsCardOn(page), assignmentTitle);
    await expect(reloadedRow).toContainText("Submitted");
    await reloadedRow.locator("summary").click();

    const viewButton = reloadedRow.getByRole("button", { name: /answer\.pdf/ });
    await clickViewAndVerifySignedFile(
      page,
      viewButton,
      "assignment-submissions",
      buildPhase16FixtureAttachmentPdf(),
    );
  });
});
