import { test, expect, type Page } from "@playwright/test";
import {
  hasRealSupabaseCredentials,
  createPhase15AdminIdentity,
  deletePhase15AdminIdentity,
  Phase15PartialAdminIdentityError,
  type Phase15AdminIdentity,
  createPhase15TrainerPortalIdentity,
  deletePhase15TrainerPortalIdentity,
  Phase15PartialTrainerPortalIdentityError,
  type Phase15TrainerPortalIdentity,
  createPhase15StudentPortalIdentity,
  deletePhase15StudentPortalIdentity,
  Phase15PartialStudentPortalIdentityError,
  type Phase15StudentPortalIdentity,
  findExistingProgramWithBatch,
  type ExistingProgramWithBatch,
  assignPhase15TrainerToBatch,
  deletePhase15BatchAssignmentIfSafe,
  createPhase15SyntheticEnrollment,
  deletePhase15SyntheticEnrollmentIfSafe,
  createPhase15ClassSessionDirect,
  deletePhase15ClassSessionIfSafe,
  createPhase15SyntheticModule,
  deletePhase15SyntheticModuleIfSafe,
  createPhase15MaterialDirect,
  deletePhase15MaterialIfExists,
  deletePhase15MaterialByTitleIfExists,
  buildPhase15FixturePdf,
  PHASE15_E2E_PREFIX,
  RUN_ID,
  type Phase15DeleteResult,
} from "./support/phase15-fixtures";

/**
 * Phase 15 (Learning Materials) automated acceptance suite — run against a
 * REAL dev Supabase project via the actual running Next.js app, same
 * precedent as e2e/phase14-financial-engine.spec.ts. Requires real dev
 * credentials in .env.local — skips itself cleanly otherwise.
 *
 * Requirement → Test mapping (REQUIREMENTS.md FR-70/FR-71,
 * IMPLEMENTATION_PLAN.md Phase 15):
 *   A. Admin can create a Program-scoped material through the real UI, and
 *      it appears.                                                (describe 1)
 *   B. Admin can create a Batch-scoped `file` material, and its "View"
 *      button opens a working short-lived signed Storage URL in a new tab
 *      (never a permanent public URL — no `materials` bucket object is
 *      ever reachable except through this same signed-URL path).  (describe 1)
 *   C. Admin can scope a material to an existing Module via the Program
 *      page's own picker, and the created row is actually VISIBLE,
 *      labeled "Module: <title>" — this is also the acceptance test for
 *      this phase's own getProgramMaterialsIncludingModules fix
 *      (lib/data/materials.ts): before that fix, a Module-scoped material
 *      was created successfully (RLS always allowed it) but then
 *      invisible everywhere in the Admin UI, since the Program page only
 *      ever queried program_id-scoped rows.                        (describe 1)
 *   D. Upload validation (disallowed extension, oversized file, content/
 *      extension mismatch) — covered by unit tests
 *      (lib/domain/__tests__/materials.test.ts) and action-layer tests
 *      (lib/actions/__tests__/materials.test.ts's own extension/signature-
 *      mismatch cases), not re-tested here.
 *   E. Trainer (assigned) can create a Session-scoped `file` material on
 *      their own assigned Batch's session, and view it.           (describe 2)
 *   F. Trainer (assigned) can create a Batch-scoped `link` material.
 *                                                                   (describe 2)
 *   G. Trainer has no UI path to Program/Module scoping at all —
 *      TrainerCreateMaterialForm never renders those pickers (no
 *      Trainer RLS branch exists for either, by design — never invented
 *      this phase); an unrelated Trainer's direct-URL access to a Batch/
 *      Session they are not assigned to is already covered by Phase 11/
 *      12's own trainer-authorization E2E suites (Materials adds no new
 *      route of its own), not re-tested here.
 *   H. Student (enrolled) sees their own Program- and Batch-scoped
 *      materials on their own enrollment detail page, and can open one via
 *      "View".                                                    (describe 3)
 *   I. Student cannot view another Student's Enrollment (and therefore its
 *      Materials) via direct URL — already proven by Phase 14's own (H)
 *      test against the exact same route (Materials adds no new route or
 *      authorization boundary to /student/enrollments/[id]), not
 *      re-tested here.
 *   J. Student cannot mutate — there is no mutation control anywhere on
 *      StudentMaterialsCard (read-only, no forms at all), and the server
 *      actions themselves reject a Student caller regardless
 *      (lib/actions/__tests__/materials.test.ts's own "rejects Trainer and
 *      Student" cases), not re-tested here.
 *   K. Student Materials access by enrollment status (enrolled/active/
 *      on_hold/completed allowed; lead/applicant/withdrawn/cancelled
 *      denied) — the approved Phase 15 business decision, fully covered
 *      at the RLS layer by supabase/tests/phase15_materials_test.sql
 *      (which directly proves the 'completed' and 'withdrawn'/'lead'
 *      cases), not re-tested here — creating four separate real Student
 *      Portal logins per status would duplicate that SQL coverage without
 *      exercising any additional application code (getMyMaterialsForEnrollment
 *      has no status branch of its own at all; RLS is the only thing that
 *      actually enforces this rule, by design).
 *   L. Anonymous is denied — Materials adds no new route of its own
 *      whatsoever (every Materials UI lives inside an already-existing
 *      Program/Batch/Session/Enrollment detail page), so anonymous
 *      denial on those routes is already fully covered by Phase 7/8/9/10/
 *      11's own existing E2E suites, not re-tested here.
 *   M. Storage (private bucket, no public URLs, role/scope-exact SELECT/
 *      INSERT/UPDATE/DELETE policies) — fully covered by
 *      supabase/tests/phase15_materials_test.sql; the one thing a browser
 *      test CAN additionally prove — that the signed URL Admin/Trainer/
 *      Student actually receive resolves to real, working content — is
 *      exercised in tests B/E/H above, not a separate test here.
 *   N. Student Portal regression spot-check (Phase 10).            (describe 3)
 *   O/P. Phase 9/11/12/13/14 remain functional — proven by re-running their
 *      own existing suites during manual acceptance, not a new Phase 15
 *      test.
 *
 * Every describe block owns its own Admin/Trainer/Student identity, its own
 * (program, batch) pair lookup, and its own synthetic Module/Session/
 * Enrollment/Material rows — none depend on another describe block's
 * beforeAll, since the acceptance protocol runs tests ONE AT A TIME via `-g`
 * (`npx playwright test ... -g "<test name>"`), under which a sibling
 * describe block's beforeAll never runs at all. Every real Program/Batch
 * used is only ever READ (findExistingProgramWithBatch), never mutated or
 * deleted — only new, synthetic child rows (Enrollment/Module/Session/
 * Material) are created and exact-id cleaned up.
 */

test.describe.configure({ mode: "serial" });

const skipSuite = !hasRealSupabaseCredentials();

test.skip(
  skipSuite,
  "Phase 15 live E2E suite requires real dev Supabase credentials in .env.local " +
    "(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Skipped, not failed: " +
    "this is expected in any environment without a live dev project configured.",
);

async function login(page: Page, path: string, email: string, password: string) {
  await page.goto(path);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

// Same previously-diagnosed login-race fix as every prior phase's own
// helpers — waits for the destination portal's own heading to actually
// render and for a persisted sb-* auth cookie before any caller navigates
// further, built in from the start rather than discovered the hard way
// again.
async function assertSessionPersisted(page: Page) {
  const cookies = await page.context().cookies();
  expect(
    cookies.some((c) => c.name.startsWith("sb-")),
    "expected a persisted sb-* auth cookie after a successful login",
  ).toBe(true);
}

async function loginAsAdmin(page: Page, identity: Phase15AdminIdentity) {
  await login(page, "/login/admin", identity.email, identity.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

async function loginAsTrainer(page: Page, identity: Phase15TrainerPortalIdentity) {
  await login(page, "/login/trainer", identity.email, identity.password);
  await expect(page).toHaveURL(/\/trainer$/);
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

async function loginAsStudent(page: Page, identity: Phase15StudentPortalIdentity) {
  await login(page, "/login/student", identity.email, identity.password);
  await expect(page).toHaveURL(/\/student$/);
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

function materialsCardOn(page: Page) {
  // "Materials" is a shadcn CardTitle (a plain div, no ARIA heading role) —
  // same established scoped-card idiom as every Payment Plan assertion in
  // e2e/phase14-financial-engine.spec.ts, and for the identical reason: an
  // unscoped page.getByRole("alert") would otherwise match Next's own
  // always-present, portaled route-announcer element
  // (node_modules/next/dist/client/components/app-router-announcer.js),
  // never this card's own conditional error text.
  return page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]:text-is("Materials")'),
  });
}

async function submitAndSettle(
  card: ReturnType<typeof materialsCardOn>,
  successText: string,
) {
  await Promise.race([
    card.getByRole("alert").waitFor({ state: "visible" }),
    card.getByText(successText, { exact: true }).waitFor({ state: "visible" }),
  ]);
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expect(card.getByText(successText, { exact: true })).toBeVisible();
}

// Both the Admin/Trainer "View" button (MaterialViewButton/
// TrainerMaterialViewButton/StudentMaterialViewButton) open a blank tab
// synchronously, then navigate it to the resolved URL once the server
// action resolves — a real new browser tab either way (file via signed
// Storage URL, or link/video via the stored external_url), so this same
// helper covers all three button components and both material kinds.
async function clickViewAndGetPopupUrl(
  page: Page,
  viewButton: ReturnType<Page["getByRole"]>,
) {
  const popupPromise = page.waitForEvent("popup");
  await viewButton.click();
  const popup = await popupPromise;
  await popup.waitForURL((url) => url.toString() !== "about:blank", { timeout: 15000 });
  const url = popup.url();
  await popup.close();
  return url;
}

async function runCleanupSteps(
  steps: Array<{ label: string; run: () => Promise<Phase15DeleteResult> }>,
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

// ---------------------------------------------------------------------------
// (A/B/C) Admin — Material creation across Program/Batch/Module scope.

test.describe("Admin — Material management", () => {
  let admin: Phase15AdminIdentity | undefined;
  let pair: ExistingProgramWithBatch | undefined;
  let moduleId: string | undefined;
  const moduleTitle = `${PHASE15_E2E_PREFIX} Module ${RUN_ID}`;
  const programMaterialTitle = `${PHASE15_E2E_PREFIX} Program Material ${RUN_ID}`;
  const batchMaterialTitle = `${PHASE15_E2E_PREFIX} Batch Material ${RUN_ID}`;
  const moduleMaterialTitle = `${PHASE15_E2E_PREFIX} Module Material ${RUN_ID}`;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      admin = await createPhase15AdminIdentity("Admin");
    } catch (err) {
      if (err instanceof Phase15PartialAdminIdentityError) admin = err.partial;
      throw err;
    }
    const found = await findExistingProgramWithBatch();
    if (!found) throw new Error("No existing Batch was found in the dev project.");
    pair = found;
    moduleId = await createPhase15SyntheticModule(pair.programId, moduleTitle);
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `Program-scoped material ("${programMaterialTitle}")`,
        run: () =>
          pair
            ? deletePhase15MaterialByTitleIfExists(
                "program_id",
                pair.programId,
                programMaterialTitle,
              )
            : Promise.resolve({ ok: true }),
      },
      {
        label: `Batch-scoped material ("${batchMaterialTitle}")`,
        run: () =>
          pair
            ? deletePhase15MaterialByTitleIfExists(
                "batch_id",
                pair.batchId,
                batchMaterialTitle,
              )
            : Promise.resolve({ ok: true }),
      },
      {
        label: `Module-scoped material ("${moduleMaterialTitle}")`,
        run: () =>
          moduleId
            ? deletePhase15MaterialByTitleIfExists(
                "module_id",
                moduleId,
                moduleMaterialTitle,
              )
            : Promise.resolve({ ok: true }),
      },
      {
        label: `synthetic Module (id=${moduleId ?? "none"})`,
        run: () =>
          moduleId
            ? deletePhase15SyntheticModuleIfSafe(moduleId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `admin login identity (authUserId=${admin?.authUserId ?? "none"})`,
        run: () =>
          admin ? deletePhase15AdminIdentity(admin) : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("(A) Admin can create a Program-scoped material and it appears", async ({
    page,
  }) => {
    if (!admin || !pair) throw new Error("beforeAll did not fully set up.");
    await loginAsAdmin(page, admin);
    await page.goto(`/admin/programs/${pair.programId}`);

    const card = materialsCardOn(page);
    await expect(card).toBeVisible();

    await card.locator('input[name="title"]').fill(programMaterialTitle);
    await card.locator('select[name="materialType"]').selectOption("link");
    await card
      .locator('input[name="externalUrl"]')
      .fill("https://example.com/phase15-program");
    await card.getByRole("button", { name: "Add material" }).click();

    await submitAndSettle(card, "Uploaded");
    await expect(card.getByText(programMaterialTitle, { exact: true })).toBeVisible();

    await page.reload();
    await expect(
      materialsCardOn(page).getByText(programMaterialTitle, { exact: true }),
    ).toBeVisible();
  });

  test("(B) Admin can create a Batch-scoped file material, and View opens a working signed URL", async ({
    page,
  }) => {
    if (!admin || !pair) throw new Error("beforeAll did not fully set up.");
    await loginAsAdmin(page, admin);
    await page.goto(`/admin/batches/${pair.batchId}`);

    const card = materialsCardOn(page);
    await expect(card).toBeVisible();

    await card.locator('input[name="title"]').fill(batchMaterialTitle);
    // materialType defaults to "file" — no select needed.
    await card.locator('input[type="file"][name="file"]').setInputFiles({
      name: "phase15-e2e-fixture.pdf",
      mimeType: "application/pdf",
      buffer: buildPhase15FixturePdf(),
    });
    await card.getByRole("button", { name: "Add material" }).click();

    await submitAndSettle(card, "Uploaded");
    const row = card.locator("li").filter({ hasText: batchMaterialTitle });
    await expect(row).toBeVisible();

    const url = await clickViewAndGetPopupUrl(
      page,
      row.getByRole("button", { name: "View" }),
    );
    // A short-lived SIGNED Storage URL for this exact bucket/object — never
    // a permanent public URL (the `materials` bucket has public: false,
    // supabase/migrations/20260101000027_materials_storage.sql).
    expect(url).toContain("/storage/v1/object/sign/materials/");
  });

  test("(C) Admin can scope a material to an existing Module, and it is visible (not an invisible orphan)", async ({
    page,
  }) => {
    if (!admin || !pair || !moduleId) throw new Error("beforeAll did not fully set up.");
    await loginAsAdmin(page, admin);
    await page.goto(`/admin/programs/${pair.programId}`);

    const card = materialsCardOn(page);
    await card.locator("select#moduleId").selectOption(moduleId);
    await card.locator('input[name="title"]').fill(moduleMaterialTitle);
    await card.locator('select[name="materialType"]').selectOption("link");
    await card
      .locator('input[name="externalUrl"]')
      .fill("https://example.com/phase15-module");
    await card.getByRole("button", { name: "Add material" }).click();

    await submitAndSettle(card, "Uploaded");

    // The specific regression this test exists for: before this phase's own
    // getProgramMaterialsIncludingModules fix, a Module-scoped material was
    // created successfully (materials_write_admin always allowed it) but
    // then never appeared anywhere in the Admin UI — the Program page's
    // MaterialsSection only ever queried program_id-scoped rows. A durable
    // reload proves this is a real, persisted row, not just a client-side
    // echo of the just-submitted form.
    await expect(card.getByText(moduleMaterialTitle, { exact: true })).toBeVisible();
    await expect(card.getByText(`Module: ${moduleTitle}`)).toBeVisible();

    await page.reload();
    const reloadedCard = materialsCardOn(page);
    await expect(
      reloadedCard.getByText(moduleMaterialTitle, { exact: true }),
    ).toBeVisible();
    await expect(reloadedCard.getByText(`Module: ${moduleTitle}`)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// (E/F) Trainer — Material creation across Batch/Session scope, assigned
// Trainer only.

test.describe("Trainer — Material management", () => {
  let trainer: Phase15TrainerPortalIdentity | undefined;
  let pair: ExistingProgramWithBatch | undefined;
  let batchTrainerId: string | undefined;
  let sessionId: string | undefined;
  const sessionMaterialTitle = `${PHASE15_E2E_PREFIX} Session Material ${RUN_ID}`;
  const batchMaterialTitle = `${PHASE15_E2E_PREFIX} Trainer Batch Material ${RUN_ID}`;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      trainer = await createPhase15TrainerPortalIdentity("TrainerA");
    } catch (err) {
      if (err instanceof Phase15PartialTrainerPortalIdentityError) trainer = err.partial;
      throw err;
    }
    if (!trainer.trainerId) {
      throw new Error("beforeAll did not fully create the Trainer identity.");
    }
    const found = await findExistingProgramWithBatch();
    if (!found) throw new Error("No existing Batch was found in the dev project.");
    pair = found;
    batchTrainerId = await assignPhase15TrainerToBatch(trainer.trainerId, pair.batchId);
    sessionId = await createPhase15ClassSessionDirect({
      batchId: pair.batchId,
      sessionDate: "2099-01-01",
      topic: `${PHASE15_E2E_PREFIX} Session ${RUN_ID}`,
    });
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `Session-scoped material ("${sessionMaterialTitle}")`,
        run: () =>
          sessionId
            ? deletePhase15MaterialByTitleIfExists(
                "class_session_id",
                sessionId,
                sessionMaterialTitle,
              )
            : Promise.resolve({ ok: true }),
      },
      {
        label: `Batch-scoped material ("${batchMaterialTitle}")`,
        run: () =>
          pair
            ? deletePhase15MaterialByTitleIfExists(
                "batch_id",
                pair.batchId,
                batchMaterialTitle,
              )
            : Promise.resolve({ ok: true }),
      },
      {
        label: `class session (id=${sessionId ?? "none"})`,
        run: () =>
          sessionId
            ? deletePhase15ClassSessionIfSafe(sessionId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `batch assignment (id=${batchTrainerId ?? "none"})`,
        run: () =>
          batchTrainerId
            ? deletePhase15BatchAssignmentIfSafe(batchTrainerId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `trainer login identity (authUserId=${trainer?.authUserId ?? "none"})`,
        run: () =>
          trainer
            ? deletePhase15TrainerPortalIdentity(trainer)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("(E) Assigned Trainer can create a Session-scoped file material and view it", async ({
    page,
  }) => {
    if (!trainer || !pair || !sessionId)
      throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainer);
    await page.goto(`/trainer/batches/${pair.batchId}/sessions/${sessionId}`);

    const card = materialsCardOn(page);
    await expect(card).toBeVisible();

    await card.locator('input[name="title"]').fill(sessionMaterialTitle);
    await card.locator('input[type="file"][name="file"]').setInputFiles({
      name: "phase15-e2e-session-fixture.pdf",
      mimeType: "application/pdf",
      buffer: buildPhase15FixturePdf(),
    });
    await card.getByRole("button", { name: "Add material" }).click();

    await submitAndSettle(card, "Uploaded");
    const row = card.locator("li").filter({ hasText: sessionMaterialTitle });
    await expect(row).toBeVisible();

    const url = await clickViewAndGetPopupUrl(
      page,
      row.getByRole("button", { name: "View" }),
    );
    expect(url).toContain("/storage/v1/object/sign/materials/");
  });

  test("(F) Assigned Trainer can create a Batch-scoped link material", async ({
    page,
  }) => {
    if (!trainer || !pair) throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainer);
    await page.goto(`/trainer/batches/${pair.batchId}`);

    const card = materialsCardOn(page);
    await expect(card).toBeVisible();

    await card.locator('input[name="title"]').fill(batchMaterialTitle);
    await card.locator('select[name="materialType"]').selectOption("link");
    await card
      .locator('input[name="externalUrl"]')
      .fill("https://example.com/phase15-trainer-batch");
    await card.getByRole("button", { name: "Add material" }).click();

    await submitAndSettle(card, "Uploaded");
    await expect(card.getByText(batchMaterialTitle, { exact: true })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// (H/N) Student — Material visibility, read-only, plus a Student Portal
// regression spot-check.

test.describe("Student — Material visibility", () => {
  let student: Phase15StudentPortalIdentity | undefined;
  let pair: ExistingProgramWithBatch | undefined;
  let enrollmentId: string | undefined;
  let moduleId: string | undefined;
  let sessionId: string | undefined;
  let programMaterialId: string | undefined;
  let batchMaterialId: string | undefined;
  let moduleMaterialId: string | undefined;
  let sessionMaterialId: string | undefined;
  const programMaterialTitle = `${PHASE15_E2E_PREFIX} Student Program Material ${RUN_ID}`;
  const batchMaterialTitle = `${PHASE15_E2E_PREFIX} Student Batch Material ${RUN_ID}`;
  const moduleMaterialTitle = `${PHASE15_E2E_PREFIX} Student Module Material ${RUN_ID}`;
  const sessionMaterialTitle = `${PHASE15_E2E_PREFIX} Student Session Material ${RUN_ID}`;
  const moduleTitle = `${PHASE15_E2E_PREFIX} Student Module ${RUN_ID}`;
  const programMaterialUrl = "https://example.com/phase15-student-program";

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      student = await createPhase15StudentPortalIdentity("Student");
    } catch (err) {
      if (err instanceof Phase15PartialStudentPortalIdentityError) student = err.partial;
      throw err;
    }
    if (!student.studentId) {
      throw new Error("beforeAll did not fully create the Student identity.");
    }
    const found = await findExistingProgramWithBatch();
    if (!found) throw new Error("No existing Batch was found in the dev project.");
    pair = found;

    enrollmentId = await createPhase15SyntheticEnrollment({
      studentId: student.studentId,
      programId: pair.programId,
      batchId: pair.batchId,
      agreedFeeRupees: 15000,
    });
    // Audit finding: Module/Session-scoped materials an eligible Student is
    // RLS-authorized for were previously absent from this page entirely —
    // a Module of their own Program and a Session of their own Batch prove
    // the fix (lib/data/student-portal.ts's getMyMaterialsForEnrollment now
    // merges all four scope branches) actually surfaces them in the
    // browser, not just at the RLS layer.
    moduleId = await createPhase15SyntheticModule(pair.programId, moduleTitle);
    sessionId = await createPhase15ClassSessionDirect({
      batchId: pair.batchId,
      sessionDate: "2099-01-01",
      topic: `${PHASE15_E2E_PREFIX} Student Session ${RUN_ID}`,
    });

    // Marked directly rather than through the UI — this describe block is
    // only proving Student read-scoping, not Admin/Trainer creation
    // (already proven by the other two describe blocks' own tests).
    programMaterialId = await createPhase15MaterialDirect({
      scopeColumn: "program_id",
      scopeId: pair.programId,
      title: programMaterialTitle,
      uploadedBy: student.authUserId,
      uploadedByType: "admin",
    });
    batchMaterialId = await createPhase15MaterialDirect({
      scopeColumn: "batch_id",
      scopeId: pair.batchId,
      title: batchMaterialTitle,
      uploadedBy: student.authUserId,
      uploadedByType: "admin",
    });
    moduleMaterialId = await createPhase15MaterialDirect({
      scopeColumn: "module_id",
      scopeId: moduleId,
      title: moduleMaterialTitle,
      uploadedBy: student.authUserId,
      uploadedByType: "admin",
    });
    sessionMaterialId = await createPhase15MaterialDirect({
      scopeColumn: "class_session_id",
      scopeId: sessionId,
      title: sessionMaterialTitle,
      uploadedBy: student.authUserId,
      uploadedByType: "admin",
    });
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `Program-scoped fixture material (id=${programMaterialId ?? "none"})`,
        run: () =>
          programMaterialId
            ? deletePhase15MaterialIfExists(programMaterialId, null)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `Batch-scoped fixture material (id=${batchMaterialId ?? "none"})`,
        run: () =>
          batchMaterialId
            ? deletePhase15MaterialIfExists(batchMaterialId, null)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `Module-scoped fixture material (id=${moduleMaterialId ?? "none"})`,
        run: () =>
          moduleMaterialId
            ? deletePhase15MaterialIfExists(moduleMaterialId, null)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `Session-scoped fixture material (id=${sessionMaterialId ?? "none"})`,
        run: () =>
          sessionMaterialId
            ? deletePhase15MaterialIfExists(sessionMaterialId, null)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `synthetic Module (id=${moduleId ?? "none"})`,
        run: () =>
          moduleId
            ? deletePhase15SyntheticModuleIfSafe(moduleId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `class session (id=${sessionId ?? "none"})`,
        run: () =>
          sessionId
            ? deletePhase15ClassSessionIfSafe(sessionId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `enrollment (id=${enrollmentId ?? "none"})`,
        run: () =>
          enrollmentId
            ? deletePhase15SyntheticEnrollmentIfSafe(enrollmentId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `student login identity (authUserId=${student?.authUserId ?? "none"})`,
        run: () =>
          student
            ? deletePhase15StudentPortalIdentity(student)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("(H) Student sees their own Program/Batch/Module/Session-scoped materials, and can open one via View", async ({
    page,
  }) => {
    if (!student || !enrollmentId) throw new Error("beforeAll did not fully set up.");
    await loginAsStudent(page, student);
    await page.goto(`/student/enrollments/${enrollmentId}`);

    const card = materialsCardOn(page);
    await expect(card).toBeVisible();
    await expect(card.getByText(programMaterialTitle, { exact: true })).toBeVisible();
    await expect(card.getByText(batchMaterialTitle, { exact: true })).toBeVisible();
    // The audit-driven fix under direct test: Module/Session-scoped
    // materials are RLS-authorized for this Student but were previously
    // never surfaced on this page at all (lib/data/student-portal.ts's
    // getMyMaterialsForEnrollment only queried program_id/batch_id). Both
    // must now actually render here, not merely pass at the RLS layer.
    await expect(card.getByText(moduleMaterialTitle, { exact: true })).toBeVisible();
    await expect(card.getByText(sessionMaterialTitle, { exact: true })).toBeVisible();
    await expect(card.getByText(`Module: ${moduleTitle}`)).toBeVisible();

    const row = card.locator("li").filter({ hasText: programMaterialTitle });
    const url = await clickViewAndGetPopupUrl(
      page,
      row.getByRole("button", { name: "View" }),
    );
    expect(url).toBe(programMaterialUrl);
  });

  test("(N) Student can still log in and reach the Student Portal dashboard", async ({
    page,
  }) => {
    if (!student) throw new Error("beforeAll did not create the Student identity.");
    await loginAsStudent(page, student);
    await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  });
});
