import { test, expect, type Page } from "@playwright/test";
import {
  hasRealSupabaseCredentials,
  createPhase11LoginIdentity,
  deletePhase11LoginIdentity,
  Phase11PartialLoginIdentityError,
  type Phase11LoginIdentity,
  type Phase11RoleKind,
  createPhase11TrainerPortalIdentity,
  deletePhase11TrainerPortalIdentity,
  Phase11PartialTrainerPortalIdentityError,
  type Phase11TrainerPortalIdentity,
  createPhase11StudentPortalIdentity,
  deletePhase11StudentPortalIdentity,
  Phase11PartialStudentPortalIdentityError,
  type Phase11StudentPortalIdentity,
  findTwoExistingProgramsWithBatches,
  type ExistingProgramWithBatch,
  assignPhase11TrainerToBatch,
  deletePhase11BatchAssignmentIfSafe,
  createPhase11SyntheticStudent,
  createPhase11SyntheticEnrollment,
  deletePhase11SyntheticEnrollmentIfSafe,
  deletePhase11SyntheticStudentIfSafe,
  type Phase11DeleteResult,
} from "./support/phase11-fixtures";

/**
 * Phase 11 (Trainer Portal) automated acceptance suite — run against a REAL
 * dev Supabase project via the actual running Next.js app, same precedent as
 * e2e/phase10-student-portal.spec.ts. Requires real dev credentials in
 * .env.local — skips itself cleanly otherwise.
 *
 * Covers task items A-M:
 *   A. Trainer login + dashboard.               (describe 1)
 *   B. Trainer sees own profile.                 (describe 1)
 *   C. Trainer sees assigned Programs only.       (describe 1)
 *   D. Trainer sees assigned Batches only.        (describe 1)
 *   E. Trainer sees Students in scope only.       (describe 1)
 *   F. Unrelated Student via direct URL denied.   (describe 1)
 *   G. Unrelated Batch via route manipulation denied. (describe 1)
 *   H. No financial fields/data exposed.          (describe 1)
 *   I. Student denied from Trainer Portal.        (describe 2)
 *   L. Phase 10 Student Portal remains intact.    (describe 2)
 *   J. Anonymous denied from Trainer Portal.      (describe 3)
 *   K. Trainer denied from Admin Portal.          (describe 4)
 *   M. Admin/Super Admin not treated as Trainer.  (describe 5)
 *
 * Cross-trainer isolation at the RLS/database layer (batches/batch_trainers)
 * is covered separately by supabase/tests/phase11_trainer_portal_test.sql
 * (run via scripts/test-rls.sh, local scratch Postgres, never live data).
 * This file covers the APPLICATION's own behavior: real login, real route
 * protection, and the direct-URL/ID-manipulation defense on the Batch/
 * Student detail routes.
 */

test.describe.configure({ mode: "serial" });

const skipSuite = !hasRealSupabaseCredentials();

test.skip(
  skipSuite,
  "Phase 11 live E2E suite requires real dev Supabase credentials in .env.local " +
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
 * Same reasoning as e2e/phase10-student-portal.spec.ts's own
 * assertAuthenticatedAsStudent: waits for real page content (not a one-shot
 * URL match) and confirms a persisted sb-* auth cookie.
 */
async function assertAuthenticatedAsTrainer(page: Page) {
  await expect(page).toHaveURL(/\/trainer$/);
  await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(
    cookies.some((c) => c.name.startsWith("sb-")),
    "expected a persisted sb-* auth cookie after a successful Trainer login",
  ).toBe(true);
}

async function loginAsTrainer(page: Page, identity: Phase11TrainerPortalIdentity) {
  await login(page, "/login/trainer", identity.email, identity.password);
  await assertAuthenticatedAsTrainer(page);
}

async function createTrackedTrainerPortalIdentity(
  tag: string,
  assign: (identity: Phase11TrainerPortalIdentity) => void,
): Promise<void> {
  try {
    assign(await createPhase11TrainerPortalIdentity(tag));
  } catch (err) {
    if (err instanceof Phase11PartialTrainerPortalIdentityError) {
      assign(err.partial);
    }
    throw err;
  }
}

async function createTrackedStudentPortalIdentity(
  tag: string,
  assign: (identity: Phase11StudentPortalIdentity) => void,
): Promise<void> {
  try {
    assign(await createPhase11StudentPortalIdentity(tag));
  } catch (err) {
    if (err instanceof Phase11PartialStudentPortalIdentityError) {
      assign(err.partial);
    }
    throw err;
  }
}

async function createTrackedLoginIdentity(
  role: Phase11RoleKind,
  tag: string,
  assign: (identity: Phase11LoginIdentity) => void,
): Promise<void> {
  try {
    assign(await createPhase11LoginIdentity(role, tag));
  } catch (err) {
    if (err instanceof Phase11PartialLoginIdentityError) {
      assign(err.partial);
    }
    throw err;
  }
}

/**
 * Runs every cleanup step regardless of an earlier step's own outcome, and
 * fails the afterAll hook with every failure's own message together. Mirrors
 * e2e/phase10-student-portal.spec.ts's own runCleanupSteps.
 */
async function runCleanupSteps(
  steps: Array<{ label: string; run: () => Promise<Phase11DeleteResult> }>,
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
// (A/B/C/D/E/F/G/H) Own dashboard/profile, assigned-scope-only visibility,
// direct-URL/ID-manipulation defense on Batch/Student detail routes, and the
// financial-field absence proof — all against two independently-assigned
// synthetic Trainers so isolation is proven both ways, not by accident.

test.describe("Trainer Portal — own scope, cross-trainer isolation, and financial isolation", () => {
  let trainerA: Phase11TrainerPortalIdentity | undefined;
  let trainerB: Phase11TrainerPortalIdentity | undefined;
  let pairs: [ExistingProgramWithBatch, ExistingProgramWithBatch] | undefined;
  let assignmentAId: string | undefined;
  let assignmentBId: string | undefined;
  let studentA: { id: string; firstName: string; lastName: string } | undefined;
  let studentB: { id: string; firstName: string; lastName: string } | undefined;
  let enrollmentAId: string | undefined;
  let enrollmentBId: string | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    await createTrackedTrainerPortalIdentity("ScopeA", (identity) => {
      trainerA = identity;
    });
    await createTrackedTrainerPortalIdentity("ScopeB", (identity) => {
      trainerB = identity;
    });
    console.log(
      `[phase11 e2e] trainer A created: trainerId=${trainerA?.trainerId}, ` +
        `trainer B created: trainerId=${trainerB?.trainerId}`,
    );

    const found = await findTwoExistingProgramsWithBatches();
    if (!found) {
      throw new Error(
        "Fewer than two existing Batches were found in the dev project — Phase 11's " +
          "cross-trainer isolation checks need two distinct real (Program, Batch) pairs.",
      );
    }
    pairs = found;
    if (!trainerA?.trainerId || !trainerB?.trainerId) {
      throw new Error("beforeAll did not fully create both Trainer identities.");
    }

    assignmentAId = await assignPhase11TrainerToBatch(
      trainerA.trainerId,
      pairs[0].batchId,
    );
    assignmentBId = await assignPhase11TrainerToBatch(
      trainerB.trainerId,
      pairs[1].batchId,
    );

    studentA = await createPhase11SyntheticStudent("ScopeA");
    studentB = await createPhase11SyntheticStudent("ScopeB");
    enrollmentAId = await createPhase11SyntheticEnrollment({
      studentId: studentA.id,
      programId: pairs[0].programId,
      batchId: pairs[0].batchId,
      agreedFeeRupees: 12345,
    });
    enrollmentBId = await createPhase11SyntheticEnrollment({
      studentId: studentB.id,
      programId: pairs[1].programId,
      batchId: pairs[1].batchId,
      agreedFeeRupees: 67890,
    });
    console.log(
      `[phase11 e2e] batch assignments: A=${assignmentAId} (batch=${pairs[0].batchId}), ` +
        `B=${assignmentBId} (batch=${pairs[1].batchId}); enrollments: A=${enrollmentAId}, ` +
        `B=${enrollmentBId}`,
    );
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    // Order matters: enrollments/students first (nothing else depends on
    // them), then the batch_trainers assignment rows (batch_trainers.
    // trainer_id is `on delete restrict`, so the Trainer row cannot be
    // removed while an assignment still references it), then the Trainer
    // identities themselves.
    await runCleanupSteps([
      {
        label: `enrollment A (id=${enrollmentAId ?? "none"})`,
        run: () =>
          enrollmentAId
            ? deletePhase11SyntheticEnrollmentIfSafe(enrollmentAId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `enrollment B (id=${enrollmentBId ?? "none"})`,
        run: () =>
          enrollmentBId
            ? deletePhase11SyntheticEnrollmentIfSafe(enrollmentBId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `synthetic student A (id=${studentA?.id ?? "none"})`,
        run: () =>
          studentA
            ? deletePhase11SyntheticStudentIfSafe(studentA.id)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `synthetic student B (id=${studentB?.id ?? "none"})`,
        run: () =>
          studentB
            ? deletePhase11SyntheticStudentIfSafe(studentB.id)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `batch assignment A (id=${assignmentAId ?? "none"})`,
        run: () =>
          assignmentAId
            ? deletePhase11BatchAssignmentIfSafe(assignmentAId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `batch assignment B (id=${assignmentBId ?? "none"})`,
        run: () =>
          assignmentBId
            ? deletePhase11BatchAssignmentIfSafe(assignmentBId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `trainer A portal identity (authUserId=${trainerA?.authUserId ?? "none"})`,
        run: () =>
          trainerA
            ? deletePhase11TrainerPortalIdentity(trainerA)
            : Promise.resolve({ ok: true }),
      },
      {
        label: `trainer B portal identity (authUserId=${trainerB?.authUserId ?? "none"})`,
        run: () =>
          trainerB
            ? deletePhase11TrainerPortalIdentity(trainerB)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("(A) Trainer can log in and reach the dashboard", async ({ page }) => {
    if (!trainerA) throw new Error("beforeAll did not create trainer A.");
    await loginAsTrainer(page, trainerA);
  });

  test("(B) Trainer sees their own profile, never another Trainer's", async ({
    page,
  }) => {
    if (!trainerA || !trainerB)
      throw new Error("beforeAll did not create both trainers.");
    await loginAsTrainer(page, trainerA);

    await page.goto("/trainer/profile");
    // Same adjacent-sibling <p> scoping established throughout Phase 9/10 —
    // this Identity card's own "Name"/"Email" fields specifically, never a
    // page-wide substring search (the shell also renders the trainer's own
    // displayName elsewhere on the page).
    await expect(page.locator('p:text-is("Name") + p')).toHaveText(
      `${trainerA.firstName} ${trainerA.lastName}`,
    );
    await expect(page.locator('p:text-is("Email") + p')).toHaveText(trainerA.email);
    await expect(page.getByText(trainerB.email)).toHaveCount(0);
  });

  test("(D) Trainer sees only their assigned Batch(es), never another Trainer's", async ({
    page,
  }) => {
    if (!trainerA || !pairs) throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainerA);

    await page.goto("/trainer/batches");
    await expect(
      page.locator(`a[href="/trainer/batches/${pairs[0].batchId}"]`),
    ).toBeVisible();
    // Trainer B's assigned batch must never appear on Trainer A's list.
    await expect(
      page.locator(`a[href="/trainer/batches/${pairs[1].batchId}"]`),
    ).toHaveCount(0);
  });

  test("(C) Trainer sees only their assigned Program(s), never another Trainer's", async ({
    page,
  }) => {
    if (!trainerA || !pairs) throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainerA);

    // getMyPrograms() derives strictly from the caller's own batch_trainers
    // rows — this synthetic Trainer has exactly one, so this count is
    // deterministic regardless of any pre-existing dev data on the shared
    // real Program/Batch rows used above.
    const programsCard = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]:text-is("Assigned programs")'),
    });
    await expect(programsCard.locator('[data-slot="card-content"] p')).toHaveText("1");

    // Identity of the one visible program: the Batch detail page surfaces
    // its Program name/code, since there is no separate Programs listing
    // route in Phase 11 (only Batches/Students/Profile — see
    // lib/domain/navigation.ts's TRAINER_NAV_ITEMS).
    await page.goto(`/trainer/batches/${pairs[0].batchId}`);
    await expect(page.getByText(pairs[0].programName, { exact: false })).toBeVisible();

    // Cross-trainer program isolation: only meaningful when the two
    // existing (Program, Batch) pairs found in beforeAll happen to belong
    // to two DIFFERENT programs — if the dev project's first two batches
    // share one program, this specific negative assertion would be a false
    // failure unrelated to isolation, so it is skipped in that case.
    test.skip(
      pairs[0].programId === pairs[1].programId,
      "The two existing Batches found in this dev project share one Program — " +
        "cross-trainer Program-isolation cannot be distinguished from same-Program " +
        "visibility here. Batch- and Student-level isolation (D/E/F/G) already prove " +
        "assignment scoping independently of this check.",
    );
    await expect(page.getByText(pairs[1].programName, { exact: true })).toHaveCount(0);
  });

  test("(E) Trainer sees only Students within their assigned scope, never another Trainer's", async ({
    page,
  }) => {
    if (!trainerA || !studentA || !studentB)
      throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainerA);

    await page.goto("/trainer/students");
    await expect(
      page.locator(`a[href="/trainer/students/${studentA.id}"]`),
    ).toBeVisible();
    // Trainer B's own synthetic student must never appear on Trainer A's list.
    await expect(page.locator(`a[href="/trainer/students/${studentB.id}"]`)).toHaveCount(
      0,
    );
  });

  test("(F) Trainer cannot view an unrelated Student via direct URL/ID manipulation", async ({
    page,
  }) => {
    if (!trainerA || !studentB) throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainerA);

    // getMyStudent (lib/data/trainer-portal.ts) filters the caller's own
    // trainer_visible_students() result set by this id — a genuinely
    // existing Student outside the caller's own assignments must come back
    // identically to a nonexistent one: a plain 404, never the record.
    const response = await page.goto(`/trainer/students/${studentB.id}`);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByText(`${studentB.firstName} ${studentB.lastName}`),
    ).toHaveCount(0);
  });

  test("(F) Trainer cannot view a nonexistent Student id", async ({ page }) => {
    if (!trainerA) throw new Error("beforeAll did not create trainer A.");
    await loginAsTrainer(page, trainerA);

    const response = await page.goto(
      "/trainer/students/00000000-0000-0000-0000-000000000000",
    );
    expect(response?.status()).toBe(404);
  });

  test("(G) Trainer cannot view an unrelated Batch via route manipulation", async ({
    page,
  }) => {
    if (!trainerA || !pairs) throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainerA);

    // getMyBatch (lib/data/trainer-portal.ts) filters by BOTH this batch id
    // AND the caller's own resolved trainer id — Trainer B's real, assigned
    // batch must come back identically to a nonexistent one for Trainer A.
    const response = await page.goto(`/trainer/batches/${pairs[1].batchId}`);
    expect(response?.status()).toBe(404);
  });

  test("(G) Trainer cannot view a nonexistent Batch id", async ({ page }) => {
    if (!trainerA) throw new Error("beforeAll did not create trainer A.");
    await loginAsTrainer(page, trainerA);

    const response = await page.goto(
      "/trainer/batches/00000000-0000-0000-0000-000000000000",
    );
    expect(response?.status()).toBe(404);
  });

  test("(H) Trainer Portal never renders financial fields or values", async ({
    page,
  }) => {
    if (!trainerA || !pairs || !studentA)
      throw new Error("beforeAll did not fully set up.");
    await loginAsTrainer(page, trainerA);

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
      "/trainer",
      "/trainer/batches",
      `/trainer/batches/${pairs[0].batchId}`,
      "/trainer/students",
      `/trainer/students/${studentA.id}`,
      "/trainer/profile",
    ];

    for (const path of pagesToCheck) {
      await page.goto(path);
      const bodyText = (await page.locator("body").innerText()) ?? "";
      expect(bodyText.includes("₹"), `Unexpected rupee amount rendered on ${path}`).toBe(
        false,
      );
      for (const label of forbiddenLabels) {
        expect(
          bodyText.includes(label),
          `Unexpected financial label "${label}" rendered on ${path}`,
        ).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (I) Student authorization + (L) Phase 10 Student Portal regression
// spot-check — a real Student Portal identity, unaffected by Phase 11's
// purely-additive navigation.ts change, must still be able to log in and
// reach its own dashboard, AND must still be denied the Trainer Portal.

test.describe("Student authorization: Trainer Portal, and Phase 10 regression spot-check", () => {
  let student: Phase11StudentPortalIdentity | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    await createTrackedStudentPortalIdentity("Authz", (identity) => {
      student = identity;
    });
  });

  test.afterAll(async () => {
    if (skipSuite || !student) return;
    const result = await deletePhase11StudentPortalIdentity(student);
    expect(
      result.ok,
      `Temporary Student portal identity cleanup failed for this run ` +
        `(authUserId=${student.authUserId}, email=${student.email}): ${result.reason}. ` +
        `This identity (and, if not yet reached, its students row) may still exist in ` +
        `the dev project. Do NOT attempt automatic recovery or broaden deletion to any ` +
        `other record — verify by exact id only, and remove it manually only after ` +
        `separate approval.`,
    ).toBe(true);
  });

  test("(L) Student can still log in and reach the Student Portal dashboard", async ({
    page,
  }) => {
    if (!student) throw new Error("beforeAll did not create the Student identity.");
    await login(page, "/login/student", student.email, student.password);
    await expect(page).toHaveURL(/\/student$/);
    await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  });

  test("(I) Student is blocked from the Trainer Portal", async ({ page }) => {
    if (!student) throw new Error("beforeAll did not create the Student identity.");
    await login(page, "/login/student", student.email, student.password);
    await page.goto("/trainer");
    // Anchored to the path actually STARTING with "/trainer" right after the
    // host — same fix already established in Phase 10 for the equivalent
    // /student check (a bare /\/trainer$/ would also match /login/trainer,
    // a legitimate redirect destination here, not Trainer Portal content).
    await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/trainer(?:\/|$)/);
    await page.goto("/trainer/profile");
    await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/trainer\/profile/);
  });
});

// ---------------------------------------------------------------------------
// (J) Anonymous authorization — no fixture needed at all.

test.describe("Anonymous authorization: Trainer Portal", () => {
  test("anonymous is redirected to the Trainer login page", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/trainer");
    await expect(page).toHaveURL(/\/login\/trainer$/);
    await page.goto("/trainer/profile");
    await expect(page).toHaveURL(/\/login\/trainer$/);
  });
});

// ---------------------------------------------------------------------------
// (K) Trainer authorization — a Trainer must be denied the Admin Portal, the
// same way Trainer is already denied the Student Portal (Phase 10).

test.describe("Trainer authorization: Admin Portal", () => {
  let trainer: Phase11TrainerPortalIdentity | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    await createTrackedTrainerPortalIdentity("AuthzAdmin", (identity) => {
      trainer = identity;
    });
  });

  test.afterAll(async () => {
    if (skipSuite || !trainer) return;
    const result = await deletePhase11TrainerPortalIdentity(trainer);
    expect(
      result.ok,
      `Temporary Trainer portal identity cleanup failed for this run ` +
        `(authUserId=${trainer.authUserId}, email=${trainer.email}): ${result.reason}. ` +
        `This identity (and, if not yet reached, its trainers row) may still exist in ` +
        `the dev project. Do NOT attempt automatic recovery or broaden deletion to any ` +
        `other record — verify by exact id only, and remove it manually only after ` +
        `separate approval.`,
    ).toBe(true);
  });

  test("Trainer is blocked from the Admin Portal", async ({ page }) => {
    if (!trainer) throw new Error("beforeAll did not create the Trainer identity.");
    await loginAsTrainer(page, trainer);
    await page.goto("/admin");
    // Same anchored-path fix as every other cross-portal denial check in
    // this suite and in Phase 10 — excludes /login/admin (a legitimate
    // redirect destination here) rather than rejecting it via an unanchored
    // suffix match.
    await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/admin(?:\/|$)/);
  });
});

// ---------------------------------------------------------------------------
// (M) Admin/Super Admin authorization — being privileged must NOT grant
// Trainer Portal/identity access merely by navigating to a /trainer URL.
// canAccessRouteGroup (lib/domain/rbac.ts) only ever returns true for
// "trainer" role on the "trainer" group — Admin/Super Admin are redirected
// to their own home (/admin) by app/trainer/layout.tsx's existing (Phase 3)
// gate, unchanged by Phase 11.

test.describe("Admin/Super Admin authorization: Trainer Portal (no masquerading)", () => {
  let admin: Phase11LoginIdentity | undefined;
  let superAdmin: Phase11LoginIdentity | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    await createTrackedLoginIdentity("admin", "masq-admin", (identity) => {
      admin = identity;
    });
    await createTrackedLoginIdentity("super_admin", "masq-superadmin", (identity) => {
      superAdmin = identity;
    });
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: `admin login identity (authUserId=${admin?.authUserId ?? "none"})`,
        run: () =>
          admin ? deletePhase11LoginIdentity(admin) : Promise.resolve({ ok: true }),
      },
      {
        label: `super admin login identity (authUserId=${superAdmin?.authUserId ?? "none"})`,
        run: () =>
          superAdmin
            ? deletePhase11LoginIdentity(superAdmin)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("Admin is redirected away from the Trainer Portal, including nested routes", async ({
    page,
  }) => {
    if (!admin) throw new Error("beforeAll did not create the Admin identity.");
    await login(page, "/login/admin", admin.email, admin.password);
    await page.goto("/trainer");
    await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/trainer(?:\/|$)/);
    await page.goto("/trainer/profile");
    await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/trainer\/profile/);
  });

  test("Super Admin is redirected away from the Trainer Portal, including nested routes", async ({
    page,
  }) => {
    if (!superAdmin)
      throw new Error("beforeAll did not create the Super Admin identity.");
    await login(page, "/login/admin", superAdmin.email, superAdmin.password);
    await page.goto("/trainer");
    await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/trainer(?:\/|$)/);
    await page.goto("/trainer/profile");
    await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/trainer\/profile/);
  });
});
