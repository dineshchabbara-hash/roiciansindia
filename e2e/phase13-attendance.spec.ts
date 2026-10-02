import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  hasRealSupabaseCredentials,
  createPhase13AdminIdentity,
  deletePhase13AdminIdentity,
  Phase13PartialAdminIdentityError,
  type Phase13AdminIdentity,
  createPhase13TrainerPortalIdentity,
  deletePhase13TrainerPortalIdentity,
  Phase13PartialTrainerPortalIdentityError,
  type Phase13TrainerPortalIdentity,
  createPhase13StudentPortalIdentity,
  deletePhase13StudentPortalIdentity,
  Phase13PartialStudentPortalIdentityError,
  type Phase13StudentPortalIdentity,
  findTwoExistingProgramsWithBatches,
  type ExistingProgramWithBatch,
  assignPhase13TrainerToBatch,
  deletePhase13BatchAssignmentIfSafe,
  createPhase13SyntheticEnrollment,
  deletePhase13SyntheticEnrollmentIfSafe,
  createPhase13ClassSessionDirect,
  deletePhase13ClassSessionIfSafe,
  createPhase13AttendanceDirect,
  deletePhase13AttendanceIfSafe,
  deletePhase13MarkedAttendanceIfSafe,
  type Phase13DeleteResult,
} from "./support/phase13-fixtures";

/**
 * Phase 13 (Attendance) automated acceptance suite — run against a REAL dev
 * Supabase project via the actual running Next.js app, same precedent as
 * e2e/phase12-class-sessions.spec.ts. Requires real dev credentials in
 * .env.local — skips itself cleanly otherwise.
 *
 * Requirement → Test mapping (REQUIREMENTS.md FR-44/52/54/61/62/63,
 * IMPLEMENTATION_PLAN.md Phase 13):
 *   A. Admin can reach Attendance for a Class Session.          (describe 1)
 *   B. Trainer can reach Attendance for an assigned Batch's
 *      Class Session.                                           (describe 2)
 *   C. Unrelated Trainer cannot access Attendance for another
 *      Batch's Class Session (direct URL).                      (describe 2)
 *   D. Eligible roster contains only students enrolled in the
 *      session's own Batch (asserted as part of A and B — the
 *      negative half of the same assertion, not a separate test;
 *      see those tests' own comments).                          (describe 1 + 2)
 *   E. A Student from an unrelated Batch cannot be injected into
 *      Attendance — covered at the RLS layer
 *      (supabase/tests/phase13_attendance_test.sql's own
 *      cross-batch WITH CHECK assertions), not re-tested here to
 *      avoid a redundant browser test of the same guarantee.
 *   F. Attendance status validation accepts only approved values
 *      — covered by unit tests (lib/validation/__tests__/
 *      attendance.test.ts), not re-tested here.
 *   G. Create/mark Attendance works for the authorized actor, AND
 *      a correction after initial marking also works (both halves
 *      of REQUIREMENTS.md FR-61/63 in one continuous UI flow, per
 *      actor).                                                   (describe 1 + 2)
 *   H. Attendance update/correction — folded into G above rather
 *      than a separate test (same page, same continuous flow; a
 *      standalone "correction" test would just repeat G's own
 *      setup for no distinct acceptance value).
 *   I. Duplicate Attendance is prevented — covered by the DB's own
 *      attendance_unique_per_session constraint
 *      (supabase/tests/phase13_attendance_test.sql) and by
 *      lib/data/__tests__/attendance.test.ts's insert/correct unit
 *      tests, not re-tested here.
 *   J. A nonexistent Class Session is handled safely.             (describe 1 + 2)
 *   K. A nonexistent Attendance record — there is no
 *      attendance-by-id route in this phase's delivered scope (the
 *      roster page is the only UI surface); nothing to test here
 *      distinctly from J.
 *   L. Student visibility matches the exact approved Phase 13
 *      behavior (own percentage + own per-session records, no
 *      notes/marked-by metadata).                                (describe 3)
 *   M. Anonymous user is denied.                                  (describe 4)
 *   N. Role boundaries remain intact (Trainer blocked from Admin's
 *      Attendance route; Student blocked from Trainer's).         (describe 2 + 3)
 *   O. Attendance pages never render financial fields/values.     (describe 1)
 *   P. Phase 10 Student Portal remains functional.                (describe 3)
 *
 * Every describe block owns its own Admin/Trainer/Student identities, batch
 * pair, class session(s), and (where needed) attendance row(s) — none depend
 * on another describe block's beforeAll, since the Phase 13 acceptance
 * protocol runs tests ONE AT A TIME via `-g`
 * (`npx playwright test ... -g "<test name>"`), under which a sibling
 * describe block's beforeAll never runs at all. All sessions use a fixed,
 * clearly-future session date ("2099-01-01") so date-based filtering
 * elsewhere in the app stays deterministic regardless of which real day this
 * suite runs.
 */

test.describe.configure({ mode: "serial" });

const skipSuite = !hasRealSupabaseCredentials();

test.skip(
  skipSuite,
  "Phase 13 live E2E suite requires real dev Supabase credentials in .env.local " +
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
// (and the browser's cookie jar) have necessarily settled — a real,
// previously-diagnosed defect (e2e/phase5-student-management.spec.ts's own
// git history, commits cb4af96/0454bc8, and this same suite's Phase 12
// login-helper fix). Each helper here waits for the destination portal's own
// heading to actually render and for a persisted sb-* auth cookie before any
// caller is allowed to navigate further — built in from the start rather
// than discovered the hard way again.
async function assertSessionPersisted(page: Page) {
  const cookies = await page.context().cookies();
  expect(
    cookies.some((c) => c.name.startsWith("sb-")),
    "expected a persisted sb-* auth cookie after a successful login",
  ).toBe(true);
}

async function loginAsAdmin(page: Page, identity: Phase13AdminIdentity) {
  await login(page, "/login/admin", identity.email, identity.password);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

async function loginAsTrainer(page: Page, identity: Phase13TrainerPortalIdentity) {
  await login(page, "/login/trainer", identity.email, identity.password);
  await expect(page).toHaveURL(/\/trainer$/);
  await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

async function loginAsStudent(page: Page, identity: Phase13StudentPortalIdentity) {
  await login(page, "/login/student", identity.email, identity.password);
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

async function runCleanupSteps(
  steps: Array<{ label: string; run: () => Promise<Phase13DeleteResult> }>,
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

function statusSelect(page: Page, enrollmentId: string) {
  return page.locator(`select[name="status__${enrollmentId}"]`);
}

// ---------------------------------------------------------------------------
// (A/D/G/J/O) Admin — Attendance management on a real Class Session.

test.describe("Admin — Attendance management", () => {
  let admin: Phase13AdminIdentity | undefined;
  let pairs: [ExistingProgramWithBatch, ExistingProgramWithBatch] | undefined;
  let studentOwn: Phase13StudentPortalIdentity | undefined;
  let studentUnrelated: Phase13StudentPortalIdentity | undefined;
  let enrollmentOwnId: string | undefined;
  let enrollmentUnrelatedId: string | undefined;
  let sessionId: string | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      admin = await createPhase13AdminIdentity("Admin");
    } catch (err) {
      if (err instanceof Phase13PartialAdminIdentityError) admin = err.partial;
      throw err;
    }
    const found = await findTwoExistingProgramsWithBatches();
    if (!found) {
      throw new Error("Fewer than two existing Batches were found in the dev project.");
    }
    pairs = found;

    try {
      studentOwn = await createPhase13StudentPortalIdentity("AdminOwn");
    } catch (err) {
      if (err instanceof Phase13PartialStudentPortalIdentityError)
        studentOwn = err.partial;
      throw err;
    }
    try {
      studentUnrelated = await createPhase13StudentPortalIdentity("AdminUnrelated");
    } catch (err) {
      if (err instanceof Phase13PartialStudentPortalIdentityError) {
        studentUnrelated = err.partial;
      }
      throw err;
    }
    if (!studentOwn.studentId || !studentUnrelated.studentId) {
      throw new Error("beforeAll did not fully create both Student identities.");
    }

    enrollmentOwnId = await createPhase13SyntheticEnrollment({
      studentId: studentOwn.studentId,
      programId: pairs[0].programId,
      batchId: pairs[0].batchId,
      agreedFeeRupees: 15000,
    });
    enrollmentUnrelatedId = await createPhase13SyntheticEnrollment({
      studentId: studentUnrelated.studentId,
      programId: pairs[1].programId,
      batchId: pairs[1].batchId,
      agreedFeeRupees: 15000,
    });

    sessionId = await createPhase13ClassSessionDirect({
      batchId: pairs[0].batchId,
      sessionDate: FUTURE_SESSION_DATE,
    });
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        // (G) marks, then corrects, Attendance through the UI — the
        // resulting attendance row (and, since the correction changes
        // status, its attendance_audit row) is never created via a fixture
        // helper that would hand back an id to track. This looks the row up
        // by its own exact (session, enrollment) pair, both already
        // synthetic and owned only by this describe block's beforeAll, and
        // must run BEFORE the class session / enrollment below — they are
        // its FK parents (attendance.class_session_id,
        // attendance.enrollment_id, both `on delete cascade` but never
        // relied upon here; this test's own exact-id cleanup still removes
        // them explicitly). A no-op if (G) never ran in this process (e.g.
        // filtered out via `-g`).
        label: `admin's marked attendance row (session=${sessionId ?? "none"}, enrollment=${enrollmentOwnId ?? "none"})`,
        run: () =>
          sessionId && enrollmentOwnId
            ? deletePhase13MarkedAttendanceIfSafe(sessionId, enrollmentOwnId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `admin's class session (id=${sessionId ?? "none"})`,
        run: () =>
          sessionId
            ? deletePhase13ClassSessionIfSafe(sessionId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `own-batch enrollment (id=${enrollmentOwnId ?? "none"})`,
        run: () =>
          enrollmentOwnId
            ? deletePhase13SyntheticEnrollmentIfSafe(enrollmentOwnId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `unrelated-batch enrollment (id=${enrollmentUnrelatedId ?? "none"})`,
        run: () =>
          enrollmentUnrelatedId
            ? deletePhase13SyntheticEnrollmentIfSafe(enrollmentUnrelatedId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `own student identity (authUserId=${studentOwn?.authUserId ?? "none"})`,
        run: () =>
          studentOwn
            ? deletePhase13StudentPortalIdentity(studentOwn)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `unrelated student identity (authUserId=${studentUnrelated?.authUserId ?? "none"})`,
        run: () =>
          studentUnrelated
            ? deletePhase13StudentPortalIdentity(studentUnrelated)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `admin login identity (authUserId=${admin?.authUserId ?? "none"})`,
        run: () =>
          admin ? deletePhase13AdminIdentity(admin) : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("(A/D) Admin can reach Attendance for a Class Session, and the roster shows only students enrolled in that session's own Batch", async ({
    page,
  }) => {
    if (!admin || !pairs || !studentOwn || !studentUnrelated || !sessionId) {
      throw new Error("beforeAll did not fully set up.");
    }
    await loginAsAdmin(page, admin);
    await page.goto(
      `/admin/batches/${pairs[0].batchId}/sessions/${sessionId}/attendance`,
    );

    await expect(
      page.getByRole("heading", { name: "Attendance", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(`${studentOwn.firstName} ${studentOwn.lastName}`, { exact: true }),
    ).toBeVisible();
    // studentUnrelated is enrolled in a genuinely different real Batch — a
    // real competing identity to prove isolation against, not a vacuous
    // absence (same pattern Phase 12 established for its own K test).
    await expect(
      page.getByText(`${studentUnrelated.firstName} ${studentUnrelated.lastName}`, {
        exact: true,
      }),
    ).toHaveCount(0);
  });

  test("(G) Admin can mark Attendance, then correct it, for the authorized actor", async ({
    page,
  }) => {
    if (!admin || !pairs || !studentOwn || !enrollmentOwnId || !sessionId) {
      throw new Error("beforeAll did not fully set up.");
    }
    await loginAsAdmin(page, admin);
    await page.goto(
      `/admin/batches/${pairs[0].batchId}/sessions/${sessionId}/attendance`,
    );

    await statusSelect(page, enrollmentOwnId).selectOption("present");
    await page.getByRole("button", { name: "Save attendance" }).click();
    await expect(page.getByText(/Saved — 1 marked/)).toBeVisible();

    // Durable proof via an independent reload, not just the post-submit
    // render — this project's own established idiom (Phase 9/10/12) for
    // proving a mutation actually persisted.
    await page.reload();
    await expect(statusSelect(page, enrollmentOwnId)).toHaveValue("present");

    await statusSelect(page, enrollmentOwnId).selectOption("absent");
    await page.getByRole("button", { name: "Save attendance" }).click();
    await expect(page.getByText(/Saved — 0 marked, 1 corrected/)).toBeVisible();

    await page.reload();
    await expect(statusSelect(page, enrollmentOwnId)).toHaveValue("absent");
  });

  test("(J) A nonexistent Class Session's attendance route 404s for Admin", async ({
    page,
  }) => {
    if (!admin || !pairs) throw new Error("beforeAll did not fully set up.");
    await loginAsAdmin(page, admin);
    const response = await page.goto(
      `/admin/batches/${pairs[0].batchId}/sessions/00000000-0000-0000-0000-000000000000/attendance`,
    );
    expect(response?.status()).toBe(404);
  });

  test("(O) Attendance pages never render financial fields or values", async ({
    page,
  }) => {
    if (!admin || !pairs || !sessionId)
      throw new Error("beforeAll did not fully set up.");
    await loginAsAdmin(page, admin);
    await page.goto(
      `/admin/batches/${pairs[0].batchId}/sessions/${sessionId}/attendance`,
    );

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
    const bodyText = (await page.locator("body").innerText()) ?? "";
    for (const label of forbiddenLabels) {
      expect(
        bodyText.includes(label),
        `Unexpected financial label "${label}" rendered on the Attendance page`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// (B/C/D/G/J/N) Trainer — assigned-batch-only Attendance access.

test.describe("Trainer — Attendance management", () => {
  let trainerA: Phase13TrainerPortalIdentity | undefined;
  let trainerB: Phase13TrainerPortalIdentity | undefined;
  let pairs: [ExistingProgramWithBatch, ExistingProgramWithBatch] | undefined;
  let assignmentAId: string | undefined;
  let assignmentBId: string | undefined;
  let studentOwn: Phase13StudentPortalIdentity | undefined;
  let studentUnrelated: Phase13StudentPortalIdentity | undefined;
  let enrollmentOwnId: string | undefined;
  let enrollmentUnrelatedId: string | undefined;
  let sessionId: string | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      trainerA = await createPhase13TrainerPortalIdentity("ScopeA");
    } catch (err) {
      if (err instanceof Phase13PartialTrainerPortalIdentityError) trainerA = err.partial;
      throw err;
    }
    try {
      trainerB = await createPhase13TrainerPortalIdentity("ScopeB");
    } catch (err) {
      if (err instanceof Phase13PartialTrainerPortalIdentityError) trainerB = err.partial;
      throw err;
    }
    const found = await findTwoExistingProgramsWithBatches();
    if (!found) throw new Error("Fewer than two existing Batches were found.");
    pairs = found;
    if (!trainerA.trainerId || !trainerB.trainerId) {
      throw new Error("beforeAll did not fully create both Trainer identities.");
    }
    assignmentAId = await assignPhase13TrainerToBatch(
      trainerA.trainerId,
      pairs[0].batchId,
    );
    assignmentBId = await assignPhase13TrainerToBatch(
      trainerB.trainerId,
      pairs[1].batchId,
    );

    try {
      studentOwn = await createPhase13StudentPortalIdentity("TrainerOwn");
    } catch (err) {
      if (err instanceof Phase13PartialStudentPortalIdentityError)
        studentOwn = err.partial;
      throw err;
    }
    try {
      studentUnrelated = await createPhase13StudentPortalIdentity("TrainerUnrelated");
    } catch (err) {
      if (err instanceof Phase13PartialStudentPortalIdentityError) {
        studentUnrelated = err.partial;
      }
      throw err;
    }
    if (!studentOwn.studentId || !studentUnrelated.studentId) {
      throw new Error("beforeAll did not fully create both Student identities.");
    }

    enrollmentOwnId = await createPhase13SyntheticEnrollment({
      studentId: studentOwn.studentId,
      programId: pairs[0].programId,
      batchId: pairs[0].batchId,
      agreedFeeRupees: 15000,
    });
    enrollmentUnrelatedId = await createPhase13SyntheticEnrollment({
      studentId: studentUnrelated.studentId,
      programId: pairs[1].programId,
      batchId: pairs[1].batchId,
      agreedFeeRupees: 15000,
    });

    sessionId = await createPhase13ClassSessionDirect({
      batchId: pairs[0].batchId,
      sessionDate: FUTURE_SESSION_DATE,
    });
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        // Same UI-driven-attendance cleanup gap as the Admin describe
        // block's own (G) test — see its afterAll's identical first step
        // for the full reasoning. Must run before the class session /
        // enrollment steps below, which are its FK parents.
        label: `trainer's marked attendance row (session=${sessionId ?? "none"}, enrollment=${enrollmentOwnId ?? "none"})`,
        run: () =>
          sessionId && enrollmentOwnId
            ? deletePhase13MarkedAttendanceIfSafe(sessionId, enrollmentOwnId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `trainer's class session (id=${sessionId ?? "none"})`,
        run: () =>
          sessionId
            ? deletePhase13ClassSessionIfSafe(sessionId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `own-batch enrollment (id=${enrollmentOwnId ?? "none"})`,
        run: () =>
          enrollmentOwnId
            ? deletePhase13SyntheticEnrollmentIfSafe(enrollmentOwnId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `unrelated-batch enrollment (id=${enrollmentUnrelatedId ?? "none"})`,
        run: () =>
          enrollmentUnrelatedId
            ? deletePhase13SyntheticEnrollmentIfSafe(enrollmentUnrelatedId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `batch assignment A (id=${assignmentAId ?? "none"})`,
        run: () =>
          assignmentAId
            ? deletePhase13BatchAssignmentIfSafe(assignmentAId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `batch assignment B (id=${assignmentBId ?? "none"})`,
        run: () =>
          assignmentBId
            ? deletePhase13BatchAssignmentIfSafe(assignmentBId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `own student identity (authUserId=${studentOwn?.authUserId ?? "none"})`,
        run: () =>
          studentOwn
            ? deletePhase13StudentPortalIdentity(studentOwn)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `unrelated student identity (authUserId=${studentUnrelated?.authUserId ?? "none"})`,
        run: () =>
          studentUnrelated
            ? deletePhase13StudentPortalIdentity(studentUnrelated)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `trainer A portal identity (authUserId=${trainerA?.authUserId ?? "none"})`,
        run: () =>
          trainerA
            ? deletePhase13TrainerPortalIdentity(trainerA)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `trainer B portal identity (authUserId=${trainerB?.authUserId ?? "none"})`,
        run: () =>
          trainerB
            ? deletePhase13TrainerPortalIdentity(trainerB)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("(B/D) Trainer can reach Attendance for an assigned Batch's Class Session, and the roster shows only their own batch's eligible students", async ({
    page,
  }) => {
    if (!trainerA || !pairs || !studentOwn || !studentUnrelated || !sessionId) {
      throw new Error("beforeAll did not fully set up.");
    }
    await loginAsTrainer(page, trainerA);
    await page.goto(
      `/trainer/batches/${pairs[0].batchId}/sessions/${sessionId}/attendance`,
    );

    await expect(
      page.getByRole("heading", { name: "Attendance", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(`${studentOwn.firstName} ${studentOwn.lastName}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`${studentUnrelated.firstName} ${studentUnrelated.lastName}`, {
        exact: true,
      }),
    ).toHaveCount(0);
  });

  test("(G) Trainer can mark Attendance, then correct it, for their own assigned batch", async ({
    page,
  }) => {
    if (!trainerA || !pairs || !enrollmentOwnId || !sessionId) {
      throw new Error("beforeAll did not fully set up.");
    }
    await loginAsTrainer(page, trainerA);
    await page.goto(
      `/trainer/batches/${pairs[0].batchId}/sessions/${sessionId}/attendance`,
    );

    await statusSelect(page, enrollmentOwnId).selectOption("late");
    await page.getByRole("button", { name: "Save attendance" }).click();
    await expect(page.getByText(/Saved — 1 marked/)).toBeVisible();

    await page.reload();
    await expect(statusSelect(page, enrollmentOwnId)).toHaveValue("late");

    await statusSelect(page, enrollmentOwnId).selectOption("excused");
    await page.getByRole("button", { name: "Save attendance" }).click();
    await expect(page.getByText(/Saved — 0 marked, 1 corrected/)).toBeVisible();

    await page.reload();
    await expect(statusSelect(page, enrollmentOwnId)).toHaveValue("excused");
  });

  test("(C) Trainer A cannot access Attendance for Trainer B's Batch via direct URL", async ({
    page,
  }) => {
    if (!trainerA || !pairs || !sessionId)
      throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainerA);
    // getMySession (lib/data/trainer-portal.ts) verifies the batch is one of
    // the caller's own assignments before this session can be reached — a
    // real session on an unrelated (but genuinely assigned-to-someone-else)
    // batch must come back as a plain 404.
    const response = await page.goto(
      `/trainer/batches/${pairs[1].batchId}/sessions/${sessionId}/attendance`,
    );
    expect(response?.status()).toBe(404);
  });

  test("(J) A nonexistent Class Session's attendance route 404s for a Trainer too", async ({
    page,
  }) => {
    if (!trainerA || !pairs) throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainerA);
    const response = await page.goto(
      `/trainer/batches/${pairs[0].batchId}/sessions/00000000-0000-0000-0000-000000000000/attendance`,
    );
    expect(response?.status()).toBe(404);
  });

  test("(N) Trainer is blocked from the Admin Attendance route", async ({ page }) => {
    if (!trainerA || !pairs || !sessionId)
      throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainerA);
    await page.goto(
      `/admin/batches/${pairs[0].batchId}/sessions/${sessionId}/attendance`,
    );
    // Same anchored-path pattern established throughout Phase 10/11/12 for
    // every cross-portal denial check in this suite.
    await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/admin(?:\/|$)/);
  });
});

// ---------------------------------------------------------------------------
// (L/N/P) Student — Attendance visibility, read-only.

test.describe("Student — Attendance visibility", () => {
  let student: Phase13StudentPortalIdentity | undefined;
  let pairs: [ExistingProgramWithBatch, ExistingProgramWithBatch] | undefined;
  let enrollmentId: string | undefined;
  let sessionId: string | undefined;
  let attendanceId: string | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      student = await createPhase13StudentPortalIdentity("Dashboard");
    } catch (err) {
      if (err instanceof Phase13PartialStudentPortalIdentityError) student = err.partial;
      throw err;
    }
    const found = await findTwoExistingProgramsWithBatches();
    if (!found) throw new Error("Fewer than two existing Batches were found.");
    pairs = found;
    if (!student.studentId) {
      throw new Error("beforeAll did not fully create the Student identity.");
    }

    enrollmentId = await createPhase13SyntheticEnrollment({
      studentId: student.studentId,
      programId: pairs[0].programId,
      batchId: pairs[0].batchId,
      agreedFeeRupees: 15000,
    });
    sessionId = await createPhase13ClassSessionDirect({
      batchId: pairs[0].batchId,
      sessionDate: FUTURE_SESSION_DATE,
      topic: "Phase13E2E Attendance Session",
    });
    // Marked directly rather than through the UI — this describe block is
    // only proving Student read-scoping (FR-44), not Admin/Trainer marking
    // (already proven by the Admin/Trainer describe blocks' own (G) tests).
    // marked_by has no real FK (lib/data/attendance.ts's own comment on the
    // polymorphic marker) — a fresh random id is sufficient here.
    attendanceId = await createPhase13AttendanceDirect({
      classSessionId: sessionId,
      enrollmentId,
      studentId: student.studentId,
      batchId: pairs[0].batchId,
      status: "present",
      markedBy: randomUUID(),
      markedByType: "admin",
    });
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `student's attendance row (id=${attendanceId ?? "none"})`,
        run: () =>
          attendanceId
            ? deletePhase13AttendanceIfSafe(attendanceId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `student's class session (id=${sessionId ?? "none"})`,
        run: () =>
          sessionId
            ? deletePhase13ClassSessionIfSafe(sessionId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `student's enrollment (id=${enrollmentId ?? "none"})`,
        run: () =>
          enrollmentId
            ? deletePhase13SyntheticEnrollmentIfSafe(enrollmentId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `student portal identity (authUserId=${student?.authUserId ?? "none"})`,
        run: () =>
          student
            ? deletePhase13StudentPortalIdentity(student)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("(L) Student sees their own computed Attendance percentage and record, on the dashboard and on the enrollment detail page", async ({
    page,
  }) => {
    if (!student || !enrollmentId) throw new Error("beforeAll did not fully set up.");
    await loginAsStudent(page, student);

    // Dashboard card: one marked session, all present -> 100%.
    const attendanceCard = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]:text-is("Attendance")'),
    });
    await expect(attendanceCard.getByText("100%", { exact: true })).toBeVisible();

    await page.goto(`/student/enrollments/${enrollmentId}`);
    await expect(page.getByText("100%", { exact: true })).toBeVisible();
    await expect(page.getByText("Phase13E2E Attendance Session")).toBeVisible();
    await expect(page.getByText("present", { exact: true })).toBeVisible();
  });

  test("(N) Student is blocked from the Trainer Attendance route", async ({ page }) => {
    if (!student || !pairs || !sessionId)
      throw new Error("beforeAll did not fully set up.");
    await loginAsStudent(page, student);
    await page.goto(
      `/trainer/batches/${pairs[0].batchId}/sessions/${sessionId}/attendance`,
    );
    await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/trainer(?:\/|$)/);
  });

  test("(P) Student can still log in and reach the Student Portal dashboard", async ({
    page,
  }) => {
    if (!student) throw new Error("beforeAll did not create the Student identity.");
    await loginAsStudent(page, student);
    await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// (M) Anonymous — zero access. Needs no fixtures at all: the route-group
// layout's own role gate fires before any data lookup, so a placeholder
// batch/session id pair is sufficient (same precedent as Phase 12's own
// anonymous test).

test.describe("Anonymous authorization: Attendance", () => {
  test("anonymous is redirected away from Admin and Trainer Attendance routes", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(
      "/admin/batches/00000000-0000-0000-0000-000000000000/sessions/00000000-0000-0000-0000-000000000000/attendance",
    );
    await expect(page).toHaveURL(/\/login\/admin$/);

    await page.goto(
      "/trainer/batches/00000000-0000-0000-0000-000000000000/sessions/00000000-0000-0000-0000-000000000000/attendance",
    );
    await expect(page).toHaveURL(/\/login\/trainer$/);
  });
});
