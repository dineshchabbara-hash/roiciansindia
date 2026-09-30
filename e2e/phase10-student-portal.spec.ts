import { test, expect, type Page } from "@playwright/test";
import {
  hasRealSupabaseCredentials,
  createPhase10LoginIdentity,
  deletePhase10LoginIdentity,
  createPhase10StudentPortalIdentity,
  deletePhase10StudentPortalIdentity,
  createPhase10SyntheticEnrollment,
  deletePhase10SyntheticEnrollmentIfSafe,
  findExistingProgramWithBatch,
  Phase10PartialLoginIdentityError,
  Phase10PartialStudentPortalIdentityError,
  type Phase10LoginIdentity,
  type Phase10RoleKind,
  type Phase10StudentPortalIdentity,
  type Phase10DeleteResult,
} from "./support/phase10-fixtures";

/**
 * Phase 10 (Student Portal) automated acceptance suite — run against a REAL
 * dev Supabase project via the actual running Next.js app (real browser,
 * real Server Actions, real database), matching
 * e2e/phase9-enrollment-management.spec.ts's own precedent. Requires real
 * dev credentials in .env.local — skips itself cleanly otherwise.
 *
 * Deliberately a separate, self-contained fixtures module
 * (e2e/support/phase10-fixtures.ts) rather than a reuse of Phase 9's —
 * same reasoning as that file's own header comment for why IT doesn't
 * reuse Phase 5's.
 *
 * Cross-student isolation at the RLS/database layer (a Student cannot read
 * another Student's `students` row, and the self-edit trigger blocks
 * protected fields) is covered separately by
 * supabase/tests/phase10_student_portal_test.sql (run via
 * scripts/test-rls.sh, against a local scratch Postgres instance, never
 * live data) — that is the appropriate layer for "prove the database
 * itself refuses this," not a browser test. This file covers the
 * APPLICATION's own behavior: real login, real route protection, and the
 * direct-URL/ID-manipulation defense on the Enrollment detail route.
 *
 * Test isolation (same precedent as Phase 9's authorization checks): each
 * concern below is its own describe block with its own beforeAll/afterAll,
 * so selecting any one test via `-g` creates and destroys only the
 * synthetic records that one test actually needs.
 */

test.describe.configure({ mode: "serial" });

const skipSuite = !hasRealSupabaseCredentials();

test.skip(
  skipSuite,
  "Phase 10 live E2E suite requires real dev Supabase credentials in .env.local " +
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
 * Same reasoning as e2e/phase9-enrollment-management.spec.ts's own
 * assertAuthenticatedAsAdmin: waits for real page content (not a one-shot
 * URL match) and confirms a persisted sb-* auth cookie.
 */
async function assertAuthenticatedAsStudent(page: Page) {
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(
    cookies.some((c) => c.name.startsWith("sb-")),
    "expected a persisted sb-* auth cookie after a successful Student login",
  ).toBe(true);
}

async function loginAsStudent(page: Page, identity: Phase10StudentPortalIdentity) {
  await login(page, "/login/student", identity.email, identity.password);
  await assertAuthenticatedAsStudent(page);
}

/**
 * Creates one login/portal identity for use in a beforeAll, storing
 * whatever was actually created — even a PARTIAL identity from a failed
 * setup — into the caller's own outer variable via `assign` before
 * rethrowing, so a later afterAll (which Playwright still runs even when
 * beforeAll threw) can still find and clean up exactly what was actually
 * created. Mirrors e2e/phase9-enrollment-management.spec.ts's own
 * createTrackedLoginIdentity.
 */
async function createTrackedStudentPortalIdentity(
  tag: string,
  assign: (identity: Phase10StudentPortalIdentity) => void,
): Promise<void> {
  try {
    assign(await createPhase10StudentPortalIdentity(tag));
  } catch (err) {
    if (err instanceof Phase10PartialStudentPortalIdentityError) {
      assign(err.partial);
    }
    throw err;
  }
}

async function createTrackedLoginIdentity(
  role: Phase10RoleKind,
  tag: string,
  assign: (identity: Phase10LoginIdentity) => void,
): Promise<void> {
  try {
    assign(await createPhase10LoginIdentity(role, tag));
  } catch (err) {
    if (err instanceof Phase10PartialLoginIdentityError) {
      assign(err.partial);
    }
    throw err;
  }
}

/**
 * Runs every cleanup step regardless of an earlier step's own outcome
 * (never short-circuits), collects every failure's own message, and fails
 * the afterAll hook with all of them together. Mirrors
 * e2e/phase9-enrollment-management.spec.ts's own runCleanupSteps.
 */
async function runCleanupSteps(
  steps: Array<{ label: string; run: () => Promise<Phase10DeleteResult> }>,
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
// (A/B/D/E) Own profile, own enrollment(s), and the direct-URL/ID-
// manipulation defense on the Enrollment detail route.

test.describe("Student Portal — own profile and enrollments", () => {
  let studentA: Phase10StudentPortalIdentity | undefined;
  let studentB: Phase10StudentPortalIdentity | undefined;
  let enrollmentAId: string | undefined;
  let enrollmentBId: string | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    await createTrackedStudentPortalIdentity("OwnData-A", (identity) => {
      studentA = identity;
    });
    await createTrackedStudentPortalIdentity("OwnData-B", (identity) => {
      studentB = identity;
    });
    console.log(
      `[phase10 e2e] student A created: studentId=${studentA?.studentId}, ` +
        `student B created: studentId=${studentB?.studentId}`,
    );

    const existing = await findExistingProgramWithBatch();
    if (!existing) {
      throw new Error(
        "No existing Program with at least one Batch was found in the dev project.",
      );
    }
    if (!studentA?.studentId || !studentB?.studentId) {
      throw new Error("beforeAll did not fully create both student identities.");
    }
    enrollmentAId = await createPhase10SyntheticEnrollment({
      studentId: studentA.studentId,
      programId: existing.programId,
      batchId: existing.batchId,
      agreedFeeRupees: 15000,
    });
    enrollmentBId = await createPhase10SyntheticEnrollment({
      studentId: studentB.studentId,
      programId: existing.programId,
      batchId: existing.batchId,
      agreedFeeRupees: 20000,
    });
    console.log(
      `[phase10 e2e] enrollments created: A=${enrollmentAId}, B=${enrollmentBId}`,
    );
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `enrollment A (id=${enrollmentAId ?? "none"})`,
        run: () =>
          enrollmentAId
            ? deletePhase10SyntheticEnrollmentIfSafe(enrollmentAId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `enrollment B (id=${enrollmentBId ?? "none"})`,
        run: () =>
          enrollmentBId
            ? deletePhase10SyntheticEnrollmentIfSafe(enrollmentBId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `student A portal identity (authUserId=${studentA?.authUserId ?? "none"})`,
        run: () =>
          studentA
            ? deletePhase10StudentPortalIdentity(studentA)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `student B portal identity (authUserId=${studentB?.authUserId ?? "none"})`,
        run: () =>
          studentB
            ? deletePhase10StudentPortalIdentity(studentB)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("Student can log in and reach the dashboard", async ({ page }) => {
    if (!studentA) throw new Error("beforeAll did not create student A.");
    await loginAsStudent(page, studentA);
  });

  test("Student sees their own profile and can update phone/address", async ({
    page,
  }) => {
    if (!studentA) throw new Error("beforeAll did not create student A.");
    await loginAsStudent(page, studentA);

    await page.goto("/student/profile");
    // Root cause of the strict-mode violation: student A's first name is
    // also a substring of the Student Portal shell's own displayName text
    // (components/student/student-shell.tsx renders it twice — once in the
    // sidebar header, once in the top header — via
    // `user.displayName ?? user.email`, where displayName is
    // "firstName lastName"), in addition to the profile page's own "Name"
    // field — three matches total for a page-wide substring search. Scoped
    // to the profile content's own Identity card specifically, via the
    // same adjacent-sibling <p> pattern already established for this exact
    // shape of label/value throughout the Phase 9 suite.
    await expect(page.locator('p:text-is("Name") + p')).toHaveText(
      `${studentA.firstName} ${studentA.lastName}`,
    );

    await page.locator("#addressLine1").fill("221B Baker Street");
    await page.locator("#city").fill("Mumbai");
    const saveButton = page.getByRole("button", { name: /Save changes|Saving/ });
    await saveButton.click();
    // Settle signal, not proof of success (same Phase 9 status-persistence
    // lesson that produced the dashboard test's own batch/status settle
    // wait): the click only dispatches the DOM event, it does not wait for
    // the Server Action's async round trip to complete, so reloading
    // immediately after can race the in-flight mutation and read the field
    // back before it was actually written. Waiting for the button to
    // re-enable (isPending clearing) proves the round trip has finished,
    // without claiming anything about whether it succeeded.
    await expect(saveButton).toBeEnabled();

    // Durable proof, not the transient "Saved" text (Phase 9's own
    // status-persistence lesson applied here from the start): an
    // independent reload reading the field's real persisted value.
    await page.reload();
    await expect(page.locator("#addressLine1")).toHaveValue("221B Baker Street");
    await expect(page.locator("#city")).toHaveValue("Mumbai");
  });

  test("Student sees only their own enrollment in the list", async ({ page }) => {
    if (!studentA || !enrollmentAId) {
      throw new Error("beforeAll did not create student A's enrollment.");
    }
    await loginAsStudent(page, studentA);

    await page.goto("/student/enrollments");
    // Root cause of the strict-mode violation: student A's own card
    // (components/student/student-enrollment-card.tsx) renders BOTH a
    // "Total payable" field AND an "Outstanding" field, and since no
    // payment exists yet for this synthetic enrollment, outstanding ===
    // total payable — the exact same "₹15,000" text appears twice on this
    // one card, not on two different students' cards. Not a data-isolation
    // problem: scoped to student A's own card specifically (identified by
    // its "View details" link's exact href, the same enrollment id this
    // test itself created — a genuine ownership marker, not a DOM index),
    // then to the Total payable field within it specifically, via the same
    // adjacent-sibling <p> pattern already established for this exact label
    // throughout the Phase 9 suite.
    const studentACard = page
      .locator('[data-slot="card"]')
      .filter({ has: page.locator(`a[href="/student/enrollments/${enrollmentAId}"]`) });
    await expect(studentACard.locator('p:text-is("Total payable") + p')).toHaveText(
      "₹15,000",
    );
    // Student B's own known fee must never appear on Student A's list.
    await expect(page.getByText("₹20,000")).toHaveCount(0);
  });

  test("Student can open their own enrollment detail page", async ({ page }) => {
    if (!studentA || !enrollmentAId) {
      throw new Error("beforeAll did not create student A's enrollment.");
    }
    await loginAsStudent(page, studentA);

    // Ownership proof: navigating to this exact enrollment id (created for
    // student A by this test's own fixtures) resolves with a real 200, not
    // the 404 the direct-URL/ID-manipulation test below proves for a
    // DIFFERENT student's enrollment id.
    const response = await page.goto(`/student/enrollments/${enrollmentAId}`);
    expect(response?.status()).toBe(200);

    // Same strict-mode cause as the enrollment-list test just above: this
    // page's own "Payment status" card (app/student/enrollments/[id]/
    // page.tsx) renders both "Total payable" and "Outstanding", and with no
    // payment recorded yet they render the identical "₹15,000" text. Scoped
    // to the Total payable field specifically via the same adjacent-sibling
    // <p> pattern used above and throughout the Phase 9 suite — this page
    // has only one enrollment on it at all, so no further card-level
    // scoping is needed, only label-level.
    await expect(page.locator('p:text-is("Total payable") + p')).toHaveText("₹15,000");
  });

  test("Student cannot open another student's enrollment by direct URL/ID manipulation", async ({
    page,
  }) => {
    if (!studentA || !enrollmentBId) {
      throw new Error("beforeAll did not create student B's enrollment.");
    }
    await loginAsStudent(page, studentA);

    // getMyEnrollment (lib/data/student-portal.ts) scopes by BOTH this id
    // AND student A's own resolved student id — student B's real,
    // genuinely-existing enrollment id must come back identically to a
    // nonexistent one: a plain 404, never the record's content.
    const response = await page.goto(`/student/enrollments/${enrollmentBId}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText("₹20,000")).toHaveCount(0);
  });

  test("Student cannot open a nonexistent enrollment id", async ({ page }) => {
    if (!studentA) throw new Error("beforeAll did not create student A.");
    await loginAsStudent(page, studentA);

    const response = await page.goto(
      "/student/enrollments/00000000-0000-0000-0000-000000000000",
    );
    expect(response?.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// (F) Admin authorization — an Admin logging in and navigating to the
// Student Portal must land back on their own home, never the placeholder/
// dashboard content, through URL manipulation on any /student route.

test.describe("Admin authorization: Student Portal", () => {
  let admin: Phase10LoginIdentity | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    await createTrackedLoginIdentity("admin", "authz-admin", (identity) => {
      admin = identity;
    });
  });

  test.afterAll(async () => {
    if (skipSuite || !admin) return;
    const result = await deletePhase10LoginIdentity(admin);
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

  test("Admin is redirected away from the Student Portal, including nested routes", async ({
    page,
  }) => {
    if (!admin) throw new Error("beforeAll did not create the Admin login identity.");
    await login(page, "/login/admin", admin.email, admin.password);
    await page.goto("/student");
    // Anchored to the path actually STARTING with "/student" right after
    // the host — a bare /\/student$/ also matches /login/student (it too
    // ends in the literal substring "student", preceded by "/login/" not
    // "/"), which is a legitimate redirect destination here (whichever of
    // /admin or /login/student this Admin session lands on, neither is
    // Student Portal content), never the thing this assertion is meant to
    // rule out.
    await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/student(?:\/|$)/);
    await page.goto("/student/profile");
    await expect(page).not.toHaveURL(/\/student\/profile/);
  });
});

// ---------------------------------------------------------------------------
// (G) Trainer authorization — a Trainer must be denied the Student Portal
// entirely, the same way Trainer is already denied Admin routes.

test.describe("Trainer authorization: Student Portal", () => {
  let trainer: Phase10LoginIdentity | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    await createTrackedLoginIdentity("trainer", "authz-trainer", (identity) => {
      trainer = identity;
    });
  });

  test.afterAll(async () => {
    if (skipSuite || !trainer) return;
    const result = await deletePhase10LoginIdentity(trainer);
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

  test("Trainer is blocked from the Student Portal", async ({ page }) => {
    if (!trainer) throw new Error("beforeAll did not create the Trainer login identity.");
    await login(page, "/login/trainer", trainer.email, trainer.password);
    await page.goto("/student");
    // Same fix as the Admin authorization test above: anchored to the path
    // actually STARTING with "/student" right after the host, so this
    // correctly excludes /login/student (a legitimate redirect destination
    // here) rather than rejecting it via an unanchored suffix match.
    await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/student(?:\/|$)/);
  });
});

// ---------------------------------------------------------------------------
// (H) Anonymous authorization — no fixture needed at all.

test.describe("Anonymous authorization: Student Portal", () => {
  test("anonymous is redirected to the Student login page", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/student");
    await expect(page).toHaveURL(/\/login\/student$/);
    await page.goto("/student/profile");
    await expect(page).toHaveURL(/\/login\/student$/);
  });
});
