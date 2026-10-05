import { test, expect, type Page } from "@playwright/test";
import {
  hasRealSupabaseCredentials,
  createPhase14AdminIdentity,
  deletePhase14AdminIdentity,
  Phase14PartialAdminIdentityError,
  type Phase14AdminIdentity,
  createPhase14StudentPortalIdentity,
  deletePhase14StudentPortalIdentity,
  Phase14PartialStudentPortalIdentityError,
  type Phase14StudentPortalIdentity,
  findExistingProgramWithBatch,
  type ExistingProgramWithBatch,
  createPhase14SyntheticEnrollment,
  deletePhase14SyntheticEnrollmentIfSafe,
  createPhase14PaymentPlanDirect,
  deletePhase14PaymentPlanIfSafe,
  deletePhase14PlanForEnrollmentIfExists,
  type Phase14DeleteResult,
} from "./support/phase14-fixtures";

/**
 * Phase 14 (Payment Plans & Financial Engine) automated acceptance suite —
 * run against a REAL dev Supabase project via the actual running Next.js
 * app, same precedent as e2e/phase13-attendance.spec.ts. Requires real dev
 * credentials in .env.local — skips itself cleanly otherwise.
 *
 * Requirement → Test mapping (REQUIREMENTS.md FR-90/FR-96,
 * IMPLEMENTATION_PLAN.md Phase 14):
 *   A. Admin can reach the Payment Plan section for an Enrollment with no
 *      plan yet (create form shown, no invented fields).        (describe 1)
 *   B. Admin can create a payment plan through the real UI (the worked
 *      example: registration + one installment), and the computed total
 *      persists across a reload.                                 (describe 1)
 *   C. Admin can edit an existing installment through the real UI, and the
 *      edit (and recomputed plan total) persists across a reload.
 *                                                                  (describe 1)
 *   D. A nonexistent/unrelated Enrollment id is denied — already covered by
 *      Phase 9's own enrollment-management E2E suite
 *      (phase9-enrollment-management.spec.ts), since Payment Plan adds no
 *      new route of its own (it lives inside the existing
 *      /admin/enrollments/[id] page) — not re-tested here to avoid a
 *      redundant browser test of the same guarantee.
 *   E. Installment total/program-gating validation (sum-must-match-total,
 *      installments_allowed) — covered by unit tests
 *      (lib/data/__tests__/payment-plans.test.ts) and the SQL suite
 *      (supabase/tests/phase14_financial_engine_test.sql), not re-tested
 *      here.
 *   F. Student sees their own Payment Plan (installment schedule) on their
 *      own enrollment detail page.                                (describe 2)
 *   G. Student cannot mutate a plan — there is no mutation control anywhere
 *      on the Student-facing page (StudentPaymentPlanCard renders no forms
 *      at all), and the server actions themselves reject a Student caller
 *      regardless (lib/actions/__tests__/payment-plans.test.ts's own
 *      "rejects Trainer and Student" tests) — not re-tested here.
 *   H. Student cannot view another Student's Payment Plan via direct URL
 *      manipulation.                                              (describe 2)
 *   I. Trainer is blocked from the Admin Enrollment route — already covered
 *      by Phase 9's own E2E suite (Trainer authorization: Enrollment
 *      Management); Payment Plan adds no new route, not re-tested here.
 *   J. Trainer Portal never renders financial fields — Phase 14 adds zero
 *      Trainer-facing code (no new route, component, or data function), so
 *      there is nothing new to exercise; documented, not fabricated as a
 *      test.
 *   K. Anonymous is denied.                                       (describe 3)
 *   L. Phase 9/10/12/13 remain functional — proven by re-running their own
 *      existing suites during manual acceptance, not a new Phase 14 test.
 *   M. Student Portal regression spot-check.                      (describe 2)
 *
 * Every describe block owns its own Admin/Student identities, Enrollment(s),
 * and (where needed) Payment Plan — none depend on another describe block's
 * beforeAll, since the acceptance protocol runs tests ONE AT A TIME via `-g`
 * (`npx playwright test ... -g "<test name>"`), under which a sibling
 * describe block's beforeAll never runs at all. Within the Admin describe
 * block, tests (A)/(B) share one Enrollment (both read-only or additive —
 * (A) never mutates, so running (A) then (B), or (B) alone, both start from
 * the same fresh "no plan yet" state each process); test (C) uses its OWN
 * separate Enrollment with a plan created directly in beforeAll (never
 * depending on test (B) having run), so (C) is independently runnable too.
 */

test.describe.configure({ mode: "serial" });

const skipSuite = !hasRealSupabaseCredentials();

test.skip(
  skipSuite,
  "Phase 14 live E2E suite requires real dev Supabase credentials in .env.local " +
    "(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Skipped, not failed: " +
    "this is expected in any environment without a live dev project configured.",
);

async function login(page: Page, path: string, email: string, password: string) {
  await page.goto(path);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

// Same previously-diagnosed login-race fix as e2e/phase13-attendance.spec.ts's
// own helpers — waits for the destination portal's own heading to actually
// render and for a persisted sb-* auth cookie before any caller navigates
// further, built in from the start rather than discovered the hard way again.
async function assertSessionPersisted(page: Page) {
  const cookies = await page.context().cookies();
  expect(
    cookies.some((c) => c.name.startsWith("sb-")),
    "expected a persisted sb-* auth cookie after a successful login",
  ).toBe(true);
}

async function loginAsAdmin(page: Page, identity: Phase14AdminIdentity) {
  await login(page, "/login/admin", identity.email, identity.password);
  await expect(page).toHaveURL(/\/admin$/);
  // The URL updates as soon as Next's client router applies the sign-in
  // Server Action's redirect() — it does not mean the destination route's
  // own authenticated server render (an RSC Promise.all of several data
  // calls, with no Suspense boundary) has finished and reached the browser.
  // Waiting for the page's own 'load' event here (a real, unbounded-by-the-
  // next-assertion's-5s-budget signal) before polling for the heading keeps
  // that render's full duration from having to fit inside the heading
  // check's own default timeout.
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

async function loginAsStudent(page: Page, identity: Phase14StudentPortalIdentity) {
  await login(page, "/login/student", identity.email, identity.password);
  await expect(page).toHaveURL(/\/student$/);
  // Same reasoning as loginAsAdmin above.
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

async function runCleanupSteps(
  steps: Array<{ label: string; run: () => Promise<Phase14DeleteResult> }>,
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
// (A/B/C) Admin — Payment Plan creation and editing.

test.describe("Admin — Payment Plan management", () => {
  let admin: Phase14AdminIdentity | undefined;
  let pair: ExistingProgramWithBatch | undefined;
  let studentForCreate: Phase14StudentPortalIdentity | undefined;
  let enrollmentForCreateId: string | undefined;
  let studentForEdit: Phase14StudentPortalIdentity | undefined;
  let enrollmentForEditId: string | undefined;
  let planForEditId: string | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      admin = await createPhase14AdminIdentity("Admin");
    } catch (err) {
      if (err instanceof Phase14PartialAdminIdentityError) admin = err.partial;
      throw err;
    }
    const found = await findExistingProgramWithBatch();
    if (!found) {
      throw new Error("No existing Batch was found in the dev project.");
    }
    pair = found;

    try {
      studentForCreate = await createPhase14StudentPortalIdentity("Create");
    } catch (err) {
      if (err instanceof Phase14PartialStudentPortalIdentityError)
        studentForCreate = err.partial;
      throw err;
    }
    if (!studentForCreate.studentId) {
      throw new Error("beforeAll did not fully create the 'create' Student identity.");
    }
    enrollmentForCreateId = await createPhase14SyntheticEnrollment({
      studentId: studentForCreate.studentId,
      programId: pair.programId,
      batchId: pair.batchId,
      agreedFeeRupees: 30000,
    });

    try {
      studentForEdit = await createPhase14StudentPortalIdentity("Edit");
    } catch (err) {
      if (err instanceof Phase14PartialStudentPortalIdentityError)
        studentForEdit = err.partial;
      throw err;
    }
    if (!studentForEdit.studentId) {
      throw new Error("beforeAll did not fully create the 'edit' Student identity.");
    }
    enrollmentForEditId = await createPhase14SyntheticEnrollment({
      studentId: studentForEdit.studentId,
      programId: pair.programId,
      batchId: pair.batchId,
      agreedFeeRupees: 10000,
    });
    const created = await createPhase14PaymentPlanDirect({
      enrollmentId: enrollmentForEditId,
      installments: [
        { label: "Full payment", amount: "10000.00", dueDate: "2026-06-01" },
      ],
    });
    planForEditId = created.planId;
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `UI-created plan for enrollment (id=${enrollmentForCreateId ?? "none"})`,
        run: () =>
          enrollmentForCreateId
            ? deletePhase14PlanForEnrollmentIfExists(enrollmentForCreateId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `directly-created plan for edit test (id=${planForEditId ?? "none"})`,
        run: () =>
          planForEditId
            ? deletePhase14PaymentPlanIfSafe(planForEditId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `create-test enrollment (id=${enrollmentForCreateId ?? "none"})`,
        run: () =>
          enrollmentForCreateId
            ? deletePhase14SyntheticEnrollmentIfSafe(enrollmentForCreateId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `edit-test enrollment (id=${enrollmentForEditId ?? "none"})`,
        run: () =>
          enrollmentForEditId
            ? deletePhase14SyntheticEnrollmentIfSafe(enrollmentForEditId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `create-test student identity (authUserId=${studentForCreate?.authUserId ?? "none"})`,
        run: () =>
          studentForCreate
            ? deletePhase14StudentPortalIdentity(studentForCreate)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `edit-test student identity (authUserId=${studentForEdit?.authUserId ?? "none"})`,
        run: () =>
          studentForEdit
            ? deletePhase14StudentPortalIdentity(studentForEdit)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `admin login identity (authUserId=${admin?.authUserId ?? "none"})`,
        run: () =>
          admin ? deletePhase14AdminIdentity(admin) : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("(A) Admin reaches the Payment Plan section for an Enrollment with no plan yet", async ({
    page,
  }) => {
    if (!admin || !enrollmentForCreateId)
      throw new Error("beforeAll did not fully set up.");
    await loginAsAdmin(page, admin);
    await page.goto(`/admin/enrollments/${enrollmentForCreateId}`);

    // "Payment Plan" is a shadcn CardTitle (components/ui/card.tsx renders
    // it as a plain <div data-slot="card-title">, with no implicit ARIA
    // heading role) — getByRole("heading", ...) can never match it,
    // regardless of timing or data. Scoped to the card itself, the same
    // established idiom test (B)/(C) below already use and every other
    // Card-section assertion in this codebase relies on; getByRole is
    // reserved for actual page-level <h1> elements (Dashboard/Welcome).
    const paymentPlanCard = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]:text-is("Payment Plan")'),
    });
    await expect(paymentPlanCard).toBeVisible();
    await expect(
      paymentPlanCard.getByRole("button", { name: "Create payment plan" }),
    ).toBeVisible();
  });

  test("(B) Admin can create a payment plan through the UI, and the total persists", async ({
    page,
  }) => {
    if (!admin || !enrollmentForCreateId)
      throw new Error("beforeAll did not fully set up.");
    await loginAsAdmin(page, admin);
    await page.goto(`/admin/enrollments/${enrollmentForCreateId}`);

    await page.locator('input[name="label"]').nth(0).fill("Registration");
    await page.locator('input[name="amount"]').nth(0).fill("10000.00");
    await page.locator('input[name="dueDate"]').nth(0).fill("2026-01-01");

    await page.getByRole("button", { name: "+ Add installment" }).click();
    await page.locator('input[name="label"]').nth(1).fill("Installment 1");
    await page.locator('input[name="amount"]').nth(1).fill("20000.00");
    await page.locator('input[name="dueDate"]').nth(1).fill("2026-02-01");

    // Scoped to the Payment Plan card specifically: the enrollment's own
    // Commercial Terms section shows its own "Total payable" in the exact
    // same formatDecimalAsINR format, and would collide with an unscoped
    // "₹30,000.00" text search whenever (as here) the plan total happens to
    // equal the agreed fee — same "Registration" is also a substring of the
    // Commercial Terms "Registration fee" label, so that assertion is
    // scoped here too rather than relying on exact text matching alone.
    const paymentPlanCard = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]:text-is("Payment Plan")'),
    });

    await page.getByRole("button", { name: "Create payment plan" }).click();

    // The Server Action's full round trip (auth check, existing-plan
    // check, installments_allowed check, plan insert, installments
    // insert, audit log, revalidatePath's full page re-render) is
    // several sequential real Supabase calls behind one click — the same
    // "click() resolves long before the mutation+re-render settles" race
    // class fd63d09 fixed for navigation. Waiting for a real DOM signal
    // (the create form unmounting on success, or an error alert on a
    // genuine rejection — e.g. installments_allowed=false on whichever
    // Program the fixture happened to select) lets the mutation's own
    // duration settle, using Playwright's longer default .waitFor()
    // budget instead of racing it against the next assertion's 5000ms.
    await Promise.race([
      page.getByRole("alert").waitFor({ state: "visible" }),
      page
        .getByRole("button", { name: "Create payment plan" })
        .waitFor({ state: "hidden" }),
    ]);

    // Surfaces a genuine rejection (e.g. the fixture's Program not
    // permitting installments) as its own clear, immediate failure
    // instead of the create form silently remaining and "₹30,000.00"
    // never appearing after an unrelated-looking timeout.
    await expect(page.getByRole("alert")).toHaveCount(0);

    await expect(paymentPlanCard.getByText("₹30,000.00")).toBeVisible();

    // Durable proof via an independent reload, not just the post-submit
    // render — this project's own established idiom (Phase 9/10/12/13) for
    // proving a mutation actually persisted.
    await page.reload();
    await expect(paymentPlanCard.getByText("₹30,000.00")).toBeVisible();
    await expect(
      paymentPlanCard.getByText("Registration", { exact: true }),
    ).toBeVisible();
    await expect(paymentPlanCard.getByText("Installment 1")).toBeVisible();
  });

  test("(C) Admin can edit an existing installment, and the edit persists", async ({
    page,
  }) => {
    if (!admin || !enrollmentForEditId)
      throw new Error("beforeAll did not fully set up.");
    await loginAsAdmin(page, admin);
    await page.goto(`/admin/enrollments/${enrollmentForEditId}`);

    const amountField = page.getByLabel("Amount for installment 1");
    await expect(amountField).toHaveValue("10000.00");
    await amountField.fill("12000.00");

    const row = page.locator("li").filter({ has: amountField });
    await row.getByRole("button", { name: "Save" }).click();

    // Same settle-before-assert reasoning as test (B) above: editInstallmentAction
    // has the identical shape (auth check, editInstallment's own fetch +
    // update + recomputePlanTotal, audit log, revalidatePath) behind one
    // click. Unlike the create form, this row never unmounts on success,
    // so the terminal signal is either the error alert or the edited
    // amount itself actually landing — whichever happens first.
    await Promise.race([
      page.getByRole("alert").waitFor({ state: "visible" }),
      page.getByText("₹12,000.00").waitFor({ state: "visible" }),
    ]);
    await expect(page.getByRole("alert")).toHaveCount(0);

    await expect(page.getByText("₹12,000.00")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Amount for installment 1")).toHaveValue("12000.00");
    await expect(page.getByText("₹12,000.00")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// (F/H/M) Student — Payment Plan visibility, read-only.

test.describe("Student — Payment Plan visibility", () => {
  let studentOwn: Phase14StudentPortalIdentity | undefined;
  let studentUnrelated: Phase14StudentPortalIdentity | undefined;
  let pair: ExistingProgramWithBatch | undefined;
  let enrollmentOwnId: string | undefined;
  let enrollmentUnrelatedId: string | undefined;
  let planId: string | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      studentOwn = await createPhase14StudentPortalIdentity("Own");
    } catch (err) {
      if (err instanceof Phase14PartialStudentPortalIdentityError)
        studentOwn = err.partial;
      throw err;
    }
    try {
      studentUnrelated = await createPhase14StudentPortalIdentity("Unrelated");
    } catch (err) {
      if (err instanceof Phase14PartialStudentPortalIdentityError) {
        studentUnrelated = err.partial;
      }
      throw err;
    }
    const found = await findExistingProgramWithBatch();
    if (!found) throw new Error("No existing Batch was found in the dev project.");
    pair = found;
    if (!studentOwn.studentId || !studentUnrelated.studentId) {
      throw new Error("beforeAll did not fully create both Student identities.");
    }

    enrollmentOwnId = await createPhase14SyntheticEnrollment({
      studentId: studentOwn.studentId,
      programId: pair.programId,
      batchId: pair.batchId,
      agreedFeeRupees: 20000,
    });
    enrollmentUnrelatedId = await createPhase14SyntheticEnrollment({
      studentId: studentUnrelated.studentId,
      programId: pair.programId,
      batchId: pair.batchId,
      agreedFeeRupees: 20000,
    });

    // Marked directly rather than through the UI — this describe block is
    // only proving Student read-scoping (FR-43/FR-96), not Admin creation
    // (already proven by the Admin describe block's own (B) test).
    const created = await createPhase14PaymentPlanDirect({
      enrollmentId: enrollmentOwnId,
      installments: [
        { label: "Registration", amount: "20000.00", dueDate: "2026-03-01" },
      ],
    });
    planId = created.planId;
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `student's payment plan (id=${planId ?? "none"})`,
        run: () =>
          planId ? deletePhase14PaymentPlanIfSafe(planId) : Promise.resolve({ ok: true }),
      },
      {
        label: `own enrollment (id=${enrollmentOwnId ?? "none"})`,
        run: () =>
          enrollmentOwnId
            ? deletePhase14SyntheticEnrollmentIfSafe(enrollmentOwnId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `unrelated enrollment (id=${enrollmentUnrelatedId ?? "none"})`,
        run: () =>
          enrollmentUnrelatedId
            ? deletePhase14SyntheticEnrollmentIfSafe(enrollmentUnrelatedId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `own student identity (authUserId=${studentOwn?.authUserId ?? "none"})`,
        run: () =>
          studentOwn
            ? deletePhase14StudentPortalIdentity(studentOwn)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `unrelated student identity (authUserId=${studentUnrelated?.authUserId ?? "none"})`,
        run: () =>
          studentUnrelated
            ? deletePhase14StudentPortalIdentity(studentUnrelated)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("(F) Student sees their own Payment Plan on their enrollment detail page", async ({
    page,
  }) => {
    if (!studentOwn || !enrollmentOwnId)
      throw new Error("beforeAll did not fully set up.");
    await loginAsStudent(page, studentOwn);
    await page.goto(`/student/enrollments/${enrollmentOwnId}`);

    // Scoped to the Payment Plan card — same reasoning as the Admin (B)
    // test above (the Payment status card's own "Total payable" can
    // coincide with the plan's own total in the same formatted style).
    const paymentPlanCard = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]:text-is("Payment Plan")'),
    });
    // Same correction as test (A) above: "Payment Plan" is a CardTitle
    // (a plain div, no ARIA heading role) on the Student card too
    // (components/student/student-payment-plan-card.tsx) — assert the
    // scoped card itself, not a nonexistent heading role.
    await expect(paymentPlanCard).toBeVisible();
    await expect(paymentPlanCard.getByText("₹20,000.00")).toBeVisible();
    await expect(
      paymentPlanCard.getByText("Registration", { exact: true }),
    ).toBeVisible();
  });

  test("(H) Student cannot view another Student's Payment Plan via direct URL", async ({
    page,
  }) => {
    if (!studentOwn || !enrollmentUnrelatedId)
      throw new Error("beforeAll did not fully set up.");
    await loginAsStudent(page, studentOwn);
    // getMyEnrollment (lib/data/student-portal.ts) scopes by BOTH this id
    // AND the caller's own resolved student id — a real enrollment
    // belonging to a genuinely different student must come back as a plain
    // 404, never a distinct "not yours" response.
    const response = await page.goto(`/student/enrollments/${enrollmentUnrelatedId}`);
    expect(response?.status()).toBe(404);
  });

  test("(M) Student can still log in and reach the Student Portal dashboard", async ({
    page,
  }) => {
    if (!studentOwn) throw new Error("beforeAll did not create the Student identity.");
    await loginAsStudent(page, studentOwn);
    await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// (K) Anonymous — zero access. Needs no fixtures at all: the route-group
// layout's own role gate fires before any data lookup, so a placeholder
// enrollment id is sufficient (same precedent as Phase 12/13's own
// anonymous tests).

test.describe("Anonymous authorization: Payment Plan", () => {
  test("anonymous is redirected away from the Admin Enrollment route", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/admin/enrollments/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/login\/admin$/);
  });
});
