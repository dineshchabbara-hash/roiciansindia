import { test, expect, type Page } from "@playwright/test";
// Relative import, not the "@/" alias — this pure domain module has no
// server-only import to worry about, but Playwright Test's own TS
// transform is not guaranteed to honor tsconfig.json's path alias the way
// Next.js's bundler does, so this avoids depending on that.
import { ENROLLMENT_STATUSES } from "../lib/domain/enrollments";
import {
  hasRealSupabaseCredentials,
  createPhase9LoginIdentity,
  deletePhase9LoginIdentity,
  createPhase9SyntheticStudent,
  deletePhase9SyntheticStudentIfSafe,
  deletePhase9SyntheticEnrollmentIfSafe,
  findExistingProgramWithBatch,
  Phase9PartialLoginIdentityError,
  type Phase9LoginIdentity,
  type Phase9RoleKind,
  type Phase9DeleteResult,
} from "./support/phase9-fixtures";

/**
 * Phase 9 (Enrollment Management) automated acceptance suite — run against a
 * REAL dev Supabase project via the actual running Next.js app (real
 * browser, real Server Actions, real database), matching
 * e2e/phase5-student-management.spec.ts's own precedent. Requires real dev
 * credentials in .env.local — skips itself cleanly otherwise.
 *
 * Deliberately NOT a reuse of e2e/support/phase5-fixtures.ts's cleanup
 * design (see that file's own header and e2e/support/phase9-fixtures.ts):
 * this suite always knows the small, exact set of ids it created, so its
 * own fixtures module never lists/paginates/sweeps a backlog — every
 * scenario below owns and destroys only its own synthetic records.
 *
 * Login-budget note (Checkpoint 7): every test below uses its OWN,
 * uniquely-generated login identity — never shared with another test — so
 * no test can accumulate login attempts against another test's email.
 * Within a single test, exactly one real /login/<role> form submission
 * happens; playwright.config.ts's retries (0 locally, 2 under CI) mean a
 * single identity/email sees at most 1 (nominal) + 2 (CI retries) = 3
 * login attempts in the worst case, safely under the 5-per-15-minutes limit
 * (lib/auth/actions.ts's LOGIN_RATE_LIMIT).
 *
 * Test-data strategy (Checkpoint 9): no synthetic Program/Batch rows are
 * ever created. The dev project already has real Programs/Batches (11 real
 * Enrollments existed at last count) — record-changing scenarios select an
 * existing (Program, Batch) pair via findExistingProgramWithBatch(), the
 * same way a real Admin would from the real dropdowns, rather than this
 * suite fabricating throwaway commercial-catalog data. Every Enrollment and
 * Student this suite itself creates is tagged with PHASE9_E2E_STUDENT_PREFIX
 * and the phase9-e2e.internal.test email domain, and is deleted by this
 * suite's own teardown — the pre-existing real students/enrollments are
 * only ever read, never modified or deleted.
 *
 * Cleanup-failure visibility (Phase 9 cleanup-safety corrections, applied
 * across every describe block below, not just the first): every afterAll
 * fails the hook itself (via `expect`) when a temporary record fails to
 * delete, rather than only logging it — a console.error alone could let a
 * run report PASS while a temporary record was left behind. A hook failure
 * is reported by Playwright as its own distinct failure, separate from —
 * never overwriting — the test body's own PASS/FAIL, so a test failure and
 * a cleanup failure occurring together both stay visible in the report.
 *
 * Partial setup-failure recovery: createPhase9LoginIdentity's own steps
 * (auth user -> user_roles -> admins/trainers profile) can fail partway
 * through, after the auth user already exists. Every beforeAll below that
 * calls it catches Phase9PartialLoginIdentityError and stores its
 * `.partial` identity in the same outer variable afterAll reads, BEFORE
 * rethrowing to still fail setup — so afterAll (which Playwright still
 * runs even when beforeAll threw) can still find and clean up exactly what
 * was actually created, rather than silently orphaning it because the
 * outer variable was never assigned.
 *
 * Test isolation (Checkpoint 9 of the cleanup-safety-correction task):
 * the Trainer/Student/anonymous authorization checks were originally one
 * describe block sharing a single beforeAll that created BOTH a Trainer
 * and a Student identity — selecting only "Trainer is blocked" via -g
 * still ran that shared beforeAll in full, creating an unused Student
 * identity (and burning part of its login budget) for no reason. Each
 * authorization check is now its OWN describe block with its OWN
 * beforeAll/afterAll, creating only the one identity it actually needs
 * (or, for the anonymous check, no identity at all) — selecting any one
 * of the three now creates and destroys only what that one test uses.
 */

test.describe.configure({ mode: "serial" });

const skipSuite = !hasRealSupabaseCredentials();

test.skip(
  skipSuite,
  "Phase 9 live E2E suite requires real dev Supabase credentials in .env.local " +
    "(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Skipped, not failed: " +
    "this is expected in any environment without a live dev project configured.",
);

async function login(page: Page, path: string, email: string, password: string) {
  await page.goto(path);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Same reasoning as e2e/phase5-student-management.spec.ts's own
 * assertAuthenticatedAsAdmin: waits for the real Dashboard heading (not a
 * one-shot URL match) and confirms a persisted sb-* auth cookie, so a
 * session that never actually settled can't slip through as "logged in".
 */
async function assertAuthenticatedAsAdmin(page: Page) {
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(
    cookies.some((c) => c.name.startsWith("sb-")),
    "expected a persisted sb-* auth cookie after a successful Admin login",
  ).toBe(true);
}

async function loginAsAdmin(page: Page, identity: Phase9LoginIdentity) {
  await login(page, "/login/admin", identity.email, identity.password);
  await assertAuthenticatedAsAdmin(page);
}

/**
 * Creates one login identity for use in a beforeAll, storing whatever was
 * actually created — even a PARTIAL identity from a failed setup — into
 * the caller's own outer variable via `assign` before rethrowing, so a
 * later afterAll (which Playwright still runs even when beforeAll threw)
 * can still find and clean it up. Without this, a failure partway through
 * createPhase9LoginIdentity (e.g. the auth user was created but its
 * admins/trainers profile insert failed) would leave the outer variable
 * unset, and afterAll's own `if (!identity) return;` guard would then
 * silently skip cleanup of an auth user that genuinely exists in the dev
 * project.
 */
async function createTrackedLoginIdentity(
  role: Phase9RoleKind,
  tag: string,
  assign: (identity: Phase9LoginIdentity) => void,
): Promise<void> {
  try {
    assign(await createPhase9LoginIdentity(role, tag));
  } catch (err) {
    if (err instanceof Phase9PartialLoginIdentityError) {
      assign(err.partial);
    }
    throw err;
  }
}

/**
 * Runs every cleanup step regardless of an earlier step's own outcome
 * (never short-circuits), collects every failure's own message, and fails
 * the afterAll hook with all of them together — so a run with more than
 * one failed cleanup step reports every one of them, not just the first.
 */
async function runCleanupSteps(
  steps: Array<{ label: string; run: () => Promise<Phase9DeleteResult> }>,
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

function parseWholeRupeeAmount(text: string): number {
  const digits = text.replace(/[^0-9]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

/**
 * Locates the Pipeline Value / Confirmed Unpaid Fees cards on the (already
 * navigated-to) /admin dashboard. CardTitle (components/ui/card.tsx) renders
 * a plain div, not a real heading element, so there is no ARIA heading role
 * to query by — each card is instead scoped by its own data-slot="card"
 * root containing its exact title text, which never accidentally matches
 * the shared grid wrapper (components/admin/dashboard/
 * enrollment-financial-classification-section.tsx) that contains all three
 * cards' titles. Both cards render behind a <Suspense> boundary
 * (app/admin/page.tsx) — this waits for the real title text (not the
 * FinancialClassificationSkeleton fallback) before returning, so a caller's
 * immediately-following `.innerText()` read can never race the skeleton.
 */
async function readFinancialClassificationCards(page: Page): Promise<{
  pipelineCard: ReturnType<Page["locator"]>;
  confirmedCard: ReturnType<Page["locator"]>;
}> {
  const pipelineCard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText("Potential Pipeline Value", { exact: true }) });
  const confirmedCard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText("Confirmed Unpaid Fees", { exact: true }) });
  await expect(pipelineCard).toBeVisible();
  await expect(confirmedCard).toBeVisible();
  return { pipelineCard, confirmedCard };
}

// ---------------------------------------------------------------------------
// (A) Enrollment list — read-only UI actions, but classified
// DATABASE-CHANGING overall (Checkpoint 6): its own beforeAll creates a
// dedicated Admin login identity. The Enrollments viewed/searched/filtered
// are the dev project's own real, pre-existing records — read only, never
// modified, matching Checkpoint 9's "never reuse real enrollments as
// fixtures" (nothing here treats them as disposable; they are only read).

test.describe("Enrollment list: real data, search, filter, pagination", () => {
  let admin: Phase9LoginIdentity | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    admin = await createPhase9LoginIdentity("admin", "list");
    if (admin) {
      // Printed so a human can capture the exact identifiers for a
      // post-run, exact-id (never prefix/pattern-based) verification query
      // if cleanup below ever reports a failure — no secret (password) is
      // ever logged, only the id/email this run itself generated.
      console.log(
        `[phase9 e2e] list-test fixture created: authUserId=${admin.authUserId} email=${admin.email}`,
      );
    }
  });

  // Corrected (Phase 9 first-test cleanup-safety correction): a cleanup
  // failure used to be only a console.error, which could produce a
  // misleading PASS while the temporary Admin identity (and its admins
  // profile row) remained in the dev project. This now fails the afterAll
  // hook itself via `expect`, which Playwright reports as its own distinct
  // failure — separate from, and never overwriting, the test body's own
  // PASS/FAIL — so a test failure and a cleanup failure occurring together
  // both stay visible in the report. Scoped to this one describe block
  // only; the other three describe blocks in this file still use the
  // original console.error-only pattern and are unchanged by this
  // correction (see this file's own top-of-file note for why).
  test.afterAll(async () => {
    if (skipSuite || !admin) return;
    const result = await deletePhase9LoginIdentity(admin);
    expect(
      result.ok,
      `Temporary Admin login identity cleanup failed for this run ` +
        `(authUserId=${admin.authUserId}, email=${admin.email}): ${result.reason}. ` +
        `This identity (and, if not yet reached, its admins profile row) may still ` +
        `exist in the dev project. Do NOT attempt automatic recovery or broaden ` +
        `deletion to any other record — verify by exact id only, and remove it ` +
        `manually only after separate approval.`,
    ).toBe(true);
  });

  test("Admin can view the Enrollment list with genuine, correctly related data", async ({
    page,
  }) => {
    if (!admin) throw new Error("beforeAll did not create the Admin login identity.");
    await loginAsAdmin(page, admin);

    await page.goto("/admin/enrollments");
    await expect(page).toHaveURL(/\/admin\/enrollments$/);
    await expect(
      page.getByRole("heading", { name: "Enrollments", level: 1 }),
    ).toBeVisible();
    // Same corrected alert assertion as phase5-student-management.spec.ts:
    // Next.js's App Router injects a hidden, always-present, always-empty
    // role="alert" route announcer into every page — filtering to alerts
    // with real text isolates this page's own error paragraph from that.
    await expect(page.getByRole("alert").filter({ hasText: /.+/ })).toHaveCount(0);
    await expect(page.getByRole("table")).toBeVisible();

    const rows = page.locator("table tbody tr");
    const rowCount = await rows.count();
    expect(
      rowCount,
      "expected at least one real enrollment row in the dev project",
    ).toBeGreaterThan(0);

    const cells = rows.first().locator("td");
    const enrollmentCode = (await cells.nth(0).innerText()).trim();
    const studentCell = (await cells.nth(1).innerText()).trim();
    const statusCell = (await cells.nth(5).innerText()).trim();
    const totalPayableCell = (await cells.nth(6).innerText()).trim();

    // Correct relationships/values — not just "a table rendered": the
    // Enrollment code, Student "Name (code)" pairing, and money formatting
    // must all match the real shapes those columns are documented to
    // produce (lib/data/enrollments.ts / lib/domain/money.ts).
    expect(enrollmentCode).toMatch(/^ENR-\d+$/);
    expect(studentCell).toMatch(/^.+\(.+\)$/);
    expect(totalPayableCell).toMatch(/^₹[\d,]+\.\d{2}$/);
    const statusRaw = statusCell.replace(" ", "_");
    expect((ENROLLMENT_STATUSES as readonly string[]).includes(statusRaw)).toBe(true);

    // Search — isolates to exactly this Enrollment by its own code (the
    // list's `q` filter matches enrollment_code only, lib/data/
    // enrollments.ts's searchEnrollments).
    await page.goto(`/admin/enrollments?q=${encodeURIComponent(enrollmentCode)}`);
    await expect(page.getByRole("alert").filter({ hasText: /.+/ })).toHaveCount(0);
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(page.getByRole("link", { name: enrollmentCode })).toBeVisible();

    // Status filter — combined with the same code search so this assertion
    // is scoped to one specific, known Enrollment rather than the dev
    // project's whole (mutable) dataset. Matching status keeps it visible;
    // a different status excludes it.
    await page.goto(
      `/admin/enrollments?q=${encodeURIComponent(enrollmentCode)}&status=${statusRaw}`,
    );
    await expect(page.getByRole("link", { name: enrollmentCode })).toBeVisible();

    const otherStatus = ENROLLMENT_STATUSES.find((s) => s !== statusRaw)!;
    await page.goto(
      `/admin/enrollments?q=${encodeURIComponent(enrollmentCode)}&status=${otherStatus}`,
    );
    await expect(page.getByRole("link", { name: enrollmentCode })).toHaveCount(0);

    // Pagination — soft check only: the dev project's real row count (11 at
    // last confirmed count) is below the 20-row default page size, so the
    // Pagination component legitimately renders nothing (components/admin/
    // pagination.tsx returns null when totalPages <= 1). Asserting the
    // summary text is well-formed IF present avoids a false failure while
    // still catching a malformed summary if the dataset ever grows past one
    // page. Genuine multi-page pagination is NOT exercised live here —
    // reported as a coverage gap rather than forced via 20+ synthetic rows,
    // which would conflict with this suite's minimal-footprint design.
    await page.goto("/admin/enrollments");
    const summary = page.getByText(/^Page \d+ of \d+ \(\d+ total\)$/);
    if (await summary.count()) {
      await expect(summary).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// (B)-(E) Combined record-changing Admin workflow — Creation, Status
// Lifecycle, Duplicate Prevention, Batch Assignment. Kept as ONE test built
// from test.step() blocks (Checkpoint 3: Playwright cannot select an
// individual step with -g, only whole tests — the alternative, splitting
// each step into its own fully independent test, would need its own login
// AND its own synthetic student/enrollment per step purely to stay
// independently selectable, which multiplies both login count and fixture
// footprint for no acceptance-coverage benefit here, since every step
// genuinely depends on the previous one's persisted state — an Enrollment
// must exist before its Batch can be assigned, must have a Batch before it
// can become "enrolled", etc.).
//
// IMPORTANT (Checkpoint 3 point 7): the steps below share ONE authenticated
// session and ONE synthetic Enrollment. If an earlier step fails, every
// later step in this same test will not execute — Playwright reports the
// first failing step and skips the rest, so a single red run here can mean
// "only the first N steps were even attempted," not "everything after the
// failure also failed." This is reported explicitly rather than treating a
// partial run as full coverage.

test.describe("Admin enrollment record-changing workflow", () => {
  let admin: Phase9LoginIdentity | undefined;
  let studentId: string | undefined;
  let enrollmentId: string | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    await createTrackedLoginIdentity("admin", "workflow", (identity) => {
      admin = identity;
    });
    // Printed so a human can capture the exact identifiers for a post-run,
    // exact-id verification query if cleanup ever reports a failure — no
    // secret (password) is ever logged.
    console.log(
      `[phase9 e2e] workflow-test admin fixture created: authUserId=${admin?.authUserId} email=${admin?.email}`,
    );
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    // Every step below always runs, regardless of an earlier step's own
    // outcome — enrollment before student before admin (respecting the
    // enrollments.student_id / admins.auth_user_id dependency order), and
    // every failure is collected rather than only the first.
    await runCleanupSteps([
      {
        label: `enrollment (id=${enrollmentId ?? "none"})`,
        run: () =>
          enrollmentId
            ? deletePhase9SyntheticEnrollmentIfSafe(enrollmentId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `student (id=${studentId ?? "none"})`,
        run: () =>
          studentId
            ? deletePhase9SyntheticStudentIfSafe(studentId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `admin login identity (authUserId=${admin?.authUserId ?? "none"}, email=${admin?.email ?? "none"})`,
        run: () =>
          admin ? deletePhase9LoginIdentity(admin) : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("create, assign a batch, move through the status lifecycle to a terminal status, and reject a duplicate — each on this test's own isolated synthetic student/enrollment", async ({
    page,
  }) => {
    if (!admin) throw new Error("beforeAll did not create the Admin login identity.");
    const existing = await findExistingProgramWithBatch();
    if (!existing) {
      throw new Error(
        "No existing Program with at least one Batch was found in the dev project — " +
          "this suite deliberately does not create its own Program/Batch fixtures, " +
          "so this scenario cannot run without one already present.",
      );
    }

    await loginAsAdmin(page, admin);

    await test.step("Creation: correct relationships, independently-calculated total payable, persists after reload", async () => {
      const student = await createPhase9SyntheticStudent("Workflow");
      studentId = student.id;
      console.log(
        `[phase9 e2e] workflow-test synthetic student created: id=${studentId}`,
      );

      await page.goto("/admin/enrollments/new");
      await page.locator("#studentId").selectOption(student.id);
      await page.locator("#programId").selectOption(existing.programId);
      await page.locator("#regularFee").fill("10000.00");
      await page.locator("#agreedFee").fill("8000.00");
      await page.locator("#discountAmount").fill("2000.00");
      await page.locator("#discountReason").fill("Phase9 E2E test discount");
      await page.locator("#registrationFee").fill("500.00");
      await page.getByRole("button", { name: "Create enrollment" }).click();

      await expect(page).toHaveURL(/\/admin\/enrollments\/[0-9a-f-]+$/);
      enrollmentId = page.url().split("/").pop()!;
      console.log(
        `[phase9 e2e] workflow-test synthetic enrollment created: id=${enrollmentId}`,
      );

      // Independently calculated here, not copied from the domain formula's
      // own file — computeTotalPayable = agreedFee - discountAmount +
      // registrationFee + taxAmount (taxAmount is always "0"):
      // 8000.00 - 2000.00 + 500.00 + 0 = 6500.00.
      const expectedTotalPayable = "₹6,500.00";
      await expect(page.getByText(expectedTotalPayable, { exact: true })).toBeVisible();

      await page.reload();
      await expect(page.getByText(expectedTotalPayable, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("link", { name: `${student.firstName} ${student.lastName}` }),
      ).toBeVisible();
    });

    await test.step("Batch assignment: allowed while pre-enrollment, persists after reload", async () => {
      const batchSelect = page.locator('select[name="batchId"]');
      await batchSelect.selectOption(existing.batchId);
      await page.getByRole("button", { name: "Assign batch" }).click();
      await expect(page.getByText("Saved")).toBeVisible();

      await page.reload();
      await expect(page.locator('select[name="batchId"]')).toHaveValue(existing.batchId);
      await expect(
        page.getByRole("link", { name: existing.batchName, exact: true }),
      ).toBeVisible();
    });

    await test.step("Status lifecycle: an operational status requires the now-assigned batch, and persists after reload", async () => {
      await page.locator('select[name="status"]').selectOption("enrolled");
      await page.getByRole("button", { name: "Update status" }).click();
      await expect(page.getByText("Saved")).toBeVisible();

      await page.reload();
      await expect(page.locator('select[name="status"]')).toHaveValue("enrolled");
    });

    await test.step("Terminal status blocks further status changes through the normal workflow", async () => {
      await page.locator('select[name="status"]').selectOption("completed");
      await page.getByRole("button", { name: "Update status" }).click();
      await expect(page.getByText("Saved")).toBeVisible();

      await page.reload();
      // Documented rule (lib/domain/enrollments.ts's
      // isTerminalStatusChangeBlocked): once terminal, the normal status
      // control cannot move the Enrollment anywhere else — enforced by
      // disabling the control entirely, not merely by omitting one option.
      await expect(page.locator('select[name="status"]')).toHaveValue("completed");
      await expect(page.locator('select[name="status"]')).toBeDisabled();
      await expect(page.getByRole("button", { name: "Update status" })).toBeDisabled();
      await expect(
        page.getByText(
          "Terminal status — cannot be reopened through the normal workflow.",
        ),
      ).toBeVisible();
      // Batch assignment is also no longer offered once operational/terminal
      // (canAssignBatch is false for "completed") — the control itself
      // should no longer be rendered.
      await expect(
        page.getByRole("button", { name: /Assign batch|Change batch/ }),
      ).toHaveCount(0);
    });

    await test.step("Duplicate prevention: same student + same batch is rejected with a genuine error, no second enrollment created", async () => {
      if (!studentId) throw new Error("Creation step did not record a studentId.");
      await page.goto("/admin/enrollments/new");
      await page.locator("#studentId").selectOption(studentId);
      await page.locator("#programId").selectOption(existing.programId);
      await page.locator('select[name="batchId"]').selectOption(existing.batchId);
      await page.locator("#regularFee").fill("100.00");
      await page.locator("#agreedFee").fill("100.00");
      await page.getByRole("button", { name: "Create enrollment" }).click();

      // Stays on the create page — this specific error, targeted directly,
      // not a broad role="alert" count, paired with the positive proof
      // below that no second row was actually created.
      await expect(page).toHaveURL(/\/admin\/enrollments\/new$/);
      await expect(
        page.getByText("This student already has an enrollment for the selected batch."),
      ).toBeVisible();

      await page.goto(`/admin/enrollments?studentId=${studentId}`);
      await expect(page.locator("table tbody tr")).toHaveCount(1);
    });
  });
});

// ---------------------------------------------------------------------------
// (F) Financial dashboard — Pipeline Value / Confirmed Unpaid Fees reflect a
// known, zero-payment, zero-refund synthetic Enrollment. Deliberately avoids
// the unresolved FR-31-vs-code refund-formula discrepancy (see the Phase 9
// acceptance review) by never creating a refund in this scenario at all.
//
// Before/after deltas rather than absolute totals (Checkpoint 11): the dev
// project's real totals are not hardcoded anywhere below. Residual risk,
// reported rather than eliminated: this suite cannot guarantee no other
// actor changes the dev project's Enrollments between the "before" and
// "after" reads — test.describe.configure({ mode: "serial" }) at the top of
// this file at least prevents this suite's OWN other tests from racing it.
//
// IRREDUCIBLE within test-code-only changes (re-confirmed, Phase 9
// remaining-five-tests review): the Pipeline Value / Confirmed Unpaid Fees
// figures read here are project-wide aggregates computed from EVERY
// Enrollment in the dev project (lib/data/dashboard.ts), not a value
// scoped to this test's own synthetic Enrollment. If any other actor
// (a human, another process) creates/changes/removes an Enrollment in the
// same dev project in the exact window between this test's "before" and
// "after" reads, the delta assertions below can fail (or, in principle,
// coincidentally still pass) for a reason unrelated to this test's own
// correctness. There is no test-code-only fix for this — a true fix would
// need either an aggregate scoped to this test's own tagged records
// (an application change, out of scope here) or exclusive access to the
// dev project during the run (an operational control, not a code change).
// Reported as a known limitation; running this specific test should be a
// deliberate, separately considered decision — ideally in an otherwise-
// idle window — not treated as equivalent in risk to the other four.

test.describe("Dashboard financial classification reflects a known delta", () => {
  let admin: Phase9LoginIdentity | undefined;
  let studentId: string | undefined;
  let enrollmentId: string | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    await createTrackedLoginIdentity("admin", "dashboard", (identity) => {
      admin = identity;
    });
    console.log(
      `[phase9 e2e] dashboard-test admin fixture created: authUserId=${admin?.authUserId} email=${admin?.email}`,
    );
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `enrollment (id=${enrollmentId ?? "none"})`,
        run: () =>
          enrollmentId
            ? deletePhase9SyntheticEnrollmentIfSafe(enrollmentId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `student (id=${studentId ?? "none"})`,
        run: () =>
          studentId
            ? deletePhase9SyntheticStudentIfSafe(studentId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `admin login identity (authUserId=${admin?.authUserId ?? "none"}, email=${admin?.email ?? "none"})`,
        run: () =>
          admin ? deletePhase9LoginIdentity(admin) : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("a zero-payment Lead moves Pipeline Value, then an Enrolled status moves it to Confirmed Unpaid Fees, by exactly its own fee", async ({
    page,
  }) => {
    if (!admin) throw new Error("beforeAll did not create the Admin login identity.");
    const existing = await findExistingProgramWithBatch();
    if (!existing) {
      throw new Error(
        "No existing Program with at least one Batch was found in the dev project.",
      );
    }
    const KNOWN_FEE_RUPEES = 10000;

    await loginAsAdmin(page, admin);

    const before =
      await test.step("Capture Pipeline Value and Confirmed Unpaid Fees before creating anything", async () => {
        await page.goto("/admin");
        const { pipelineCard, confirmedCard } =
          await readFinancialClassificationCards(page);

        const pipelineValueRupees = parseWholeRupeeAmount(
          await pipelineCard.locator(".text-2xl").innerText(),
        );
        const pipelineCountText = await pipelineCard
          .locator(".text-muted-foreground")
          .innerText();
        const pipelineCount = parseInt(
          pipelineCountText.match(/across (\d+)/)?.[1] ?? "0",
          10,
        );

        const confirmedValueRupees = parseWholeRupeeAmount(
          await confirmedCard.locator(".text-2xl").innerText(),
        );
        const confirmedCountText = await confirmedCard
          .locator(".text-muted-foreground")
          .innerText();
        const confirmedCount = parseInt(
          confirmedCountText.match(/across (\d+)/)?.[1] ?? "0",
          10,
        );

        return {
          pipelineValueRupees,
          pipelineCount,
          confirmedValueRupees,
          confirmedCount,
        };
      });

    await test.step("Create a zero-payment Lead enrollment with a known fee", async () => {
      const student = await createPhase9SyntheticStudent("Dashboard");
      studentId = student.id;
      console.log(
        `[phase9 e2e] dashboard-test synthetic student created: id=${studentId}`,
      );

      await page.goto("/admin/enrollments/new");
      await page.locator("#studentId").selectOption(student.id);
      await page.locator("#programId").selectOption(existing.programId);
      await page.locator("#regularFee").fill(`${KNOWN_FEE_RUPEES}.00`);
      await page.locator("#agreedFee").fill(`${KNOWN_FEE_RUPEES}.00`);
      await page.getByRole("button", { name: "Create enrollment" }).click();
      await expect(page).toHaveURL(/\/admin\/enrollments\/[0-9a-f-]+$/);
      enrollmentId = page.url().split("/").pop()!;
      console.log(
        `[phase9 e2e] dashboard-test synthetic enrollment created: id=${enrollmentId}`,
      );
      // No discount/registration fee/tax here, so total_payable === the
      // agreed fee exactly: formatDecimalAsINR(10000.00) === "₹10,000.00".
      await expect(
        page.getByText(`₹${KNOWN_FEE_RUPEES.toLocaleString("en-IN")}.00`, {
          exact: true,
        }),
      ).toBeVisible();
    });

    await test.step("Pipeline Value/count increase by exactly this Enrollment's fee while it is a Lead", async () => {
      await page.goto("/admin");
      const { pipelineCard, confirmedCard } =
        await readFinancialClassificationCards(page);

      const pipelineValueRupees = parseWholeRupeeAmount(
        await pipelineCard.locator(".text-2xl").innerText(),
      );
      const pipelineCountText = await pipelineCard
        .locator(".text-muted-foreground")
        .innerText();
      const pipelineCount = parseInt(
        pipelineCountText.match(/across (\d+)/)?.[1] ?? "0",
        10,
      );

      expect(pipelineValueRupees).toBe(before.pipelineValueRupees + KNOWN_FEE_RUPEES);
      expect(pipelineCount).toBe(before.pipelineCount + 1);

      // Confirmed Unpaid Fees must be entirely unaffected by a Lead.
      const confirmedValueRupees = parseWholeRupeeAmount(
        await confirmedCard.locator(".text-2xl").innerText(),
      );
      expect(confirmedValueRupees).toBe(before.confirmedValueRupees);
    });

    await test.step("Assign a batch and move to Enrolled", async () => {
      await page.goto(`/admin/enrollments/${enrollmentId}`);
      await page.locator('select[name="batchId"]').selectOption(existing.batchId);
      await page.getByRole("button", { name: "Assign batch" }).click();
      await expect(page.getByText("Saved")).toBeVisible();

      await page.locator('select[name="status"]').selectOption("enrolled");
      await page.getByRole("button", { name: "Update status" }).click();
      await expect(page.getByText("Saved")).toBeVisible();
    });

    await test.step("Pipeline Value/count return to baseline; Confirmed Unpaid Fees/count increase by exactly this Enrollment's outstanding balance", async () => {
      await page.goto("/admin");
      const { pipelineCard, confirmedCard } =
        await readFinancialClassificationCards(page);

      const pipelineValueRupees = parseWholeRupeeAmount(
        await pipelineCard.locator(".text-2xl").innerText(),
      );
      const pipelineCountText = await pipelineCard
        .locator(".text-muted-foreground")
        .innerText();
      const pipelineCount = parseInt(
        pipelineCountText.match(/across (\d+)/)?.[1] ?? "0",
        10,
      );
      expect(pipelineValueRupees).toBe(before.pipelineValueRupees);
      expect(pipelineCount).toBe(before.pipelineCount);

      const confirmedValueRupees = parseWholeRupeeAmount(
        await confirmedCard.locator(".text-2xl").innerText(),
      );
      const confirmedCountText = await confirmedCard
        .locator(".text-muted-foreground")
        .innerText();
      const confirmedCount = parseInt(
        confirmedCountText.match(/across (\d+)/)?.[1] ?? "0",
        10,
      );
      // No payments/refunds were ever created for this enrollment, so its
      // outstanding balance (computeOutstandingFeesPaise) is exactly its
      // own total_payable: KNOWN_FEE_RUPEES, with zero rounding ambiguity
      // since it was entered as a whole-rupee amount.
      expect(confirmedValueRupees).toBe(before.confirmedValueRupees + KNOWN_FEE_RUPEES);
      expect(confirmedCount).toBe(before.confirmedCount + 1);
    });
  });
});

// ---------------------------------------------------------------------------
// (G) Authorization — non-admin roles and anonymous users are blocked from
// Enrollment Management, verified by actual server-side redirect (full page
// navigation), never by the presence/absence of a UI button alone.
//
// Each of the three checks below is its OWN describe block with its OWN
// beforeAll/afterAll (Phase 9 cleanup-safety correction, test-isolation
// fix): they used to share one describe block and one beforeAll that
// created BOTH a Trainer and a Student identity together, so selecting
// only "Trainer is blocked" via -g still created an unused Student
// identity (and consumed part of its login budget) for no reason. Now,
// selecting any one of the three creates and destroys only what that one
// test actually uses — the anonymous check creates no identity at all.

test.describe("Trainer authorization: Enrollment Management", () => {
  let trainer: Phase9LoginIdentity | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    await createTrackedLoginIdentity("trainer", "authz-trainer", (identity) => {
      trainer = identity;
    });
    console.log(
      `[phase9 e2e] trainer-authz fixture created: authUserId=${trainer?.authUserId} email=${trainer?.email}`,
    );
  });

  test.afterAll(async () => {
    if (skipSuite || !trainer) return;
    const result = await deletePhase9LoginIdentity(trainer);
    expect(
      result.ok,
      `Temporary Trainer login identity cleanup failed for this run ` +
        `(authUserId=${trainer.authUserId}, email=${trainer.email}): ${result.reason}. ` +
        `This identity (and, if not yet reached, its trainers profile row) may still ` +
        `exist in the dev project. Do NOT attempt automatic recovery or broaden ` +
        `deletion to any other record — verify by exact id only, and remove it ` +
        `manually only after separate approval.`,
    ).toBe(true);
  });

  test("Trainer is blocked from Enrollment Management", async ({ page }) => {
    if (!trainer) throw new Error("beforeAll did not create the Trainer login identity.");
    await login(page, "/login/trainer", trainer.email, trainer.password);
    await page.goto("/admin/enrollments");
    await expect(page).not.toHaveURL(/\/admin\/enrollments/);
    await page.goto("/admin/enrollments/new");
    await expect(page).not.toHaveURL(/\/admin\/enrollments\/new/);
  });
});

test.describe("Student authorization: Enrollment Management", () => {
  let student: Phase9LoginIdentity | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    await createTrackedLoginIdentity("student", "authz-student", (identity) => {
      student = identity;
    });
    console.log(
      `[phase9 e2e] student-authz fixture created: authUserId=${student?.authUserId} email=${student?.email}`,
    );
  });

  test.afterAll(async () => {
    if (skipSuite || !student) return;
    const result = await deletePhase9LoginIdentity(student);
    expect(
      result.ok,
      `Temporary Student login identity cleanup failed for this run ` +
        `(authUserId=${student.authUserId}, email=${student.email}): ${result.reason}. ` +
        `This identity may still exist in the dev project (Student identities have no ` +
        `profile row to worry about — see createPhase9LoginIdentity). Do NOT attempt ` +
        `automatic recovery or broaden deletion to any other record — verify by exact ` +
        `id only, and remove it manually only after separate approval.`,
    ).toBe(true);
  });

  test("Student is blocked from Enrollment Management", async ({ page }) => {
    if (!student) throw new Error("beforeAll did not create the Student login identity.");
    await login(page, "/login/student", student.email, student.password);
    await page.goto("/admin/enrollments");
    await expect(page).not.toHaveURL(/\/admin\/enrollments/);
    await page.goto("/admin/enrollments/new");
    await expect(page).not.toHaveURL(/\/admin\/enrollments\/new/);
  });
});

// No beforeAll/afterAll at all — this check needs no authentication
// fixture whatsoever (an anonymous, cookie-cleared browser context), so
// none is created.
test.describe("Anonymous authorization: Enrollment Management", () => {
  test("anonymous is blocked from Enrollment Management", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/admin/enrollments");
    await expect(page).toHaveURL(/\/login\/admin$/);
  });
});
