import { test, expect, type Page } from "@playwright/test";
import {
  hasRealSupabaseCredentials,
  createPhase17AdminIdentity,
  deletePhase17AdminIdentity,
  Phase17PartialAdminIdentityError,
  type Phase17AdminIdentity,
  createPhase17StudentPortalIdentity,
  deletePhase17StudentPortalIdentity,
  Phase17PartialStudentPortalIdentityError,
  type Phase17StudentPortalIdentity,
  findExistingCertificateEligibleProgramWithBatch,
  type ExistingCertificateEligibleProgramWithBatch,
  createPhase17SyntheticEnrollment,
  deletePhase17SyntheticEnrollmentIfSafe,
  createPhase17CertificateDirect,
  deletePhase17CertificateIfExists,
  deletePhase17AllCertificatesForEnrollment,
  buildPhase17FixtureCertificatePdf,
  PHASE17_E2E_PREFIX,
  RUN_ID,
  type Phase17DeleteResult,
} from "./support/phase17-fixtures";

/**
 * Phase 17 (Certificates) automated acceptance suite — run against a REAL
 * dev Supabase project via the actual running Next.js app, same precedent
 * as e2e/phase16-assignments.spec.ts. Requires real dev credentials in
 * .env.local — skips itself cleanly otherwise.
 *
 * Requirement -> Test mapping (REQUIREMENTS.md FR-100/101/102,
 * IMPLEMENTATION_PLAN.md Phase 17):
 *   A. Admin issues a certificate for an eligible Enrollment (completed +
 *      program.certificate_eligible + outstanding balance 0); it appears
 *      with a real, server-minted certificate number and the Issue form
 *      disappears once issued (alreadyIssued).           (describe 1, test 1)
 *   B. Admin sees a clear, specific reason and no Issue form at all for an
 *      ineligible Enrollment (not completed AND a real outstanding
 *      balance) — the exact three-condition rule itself (every
 *      pass/fail combination) is unit-tested in
 *      lib/domain/__tests__/certificates.test.ts (the 5 required A-E
 *      cases); this proves the real UI wiring surfaces that result.
 *                                                          (describe 1, test 2)
 *   C. Admin revokes an issued certificate (standalone, no replacement);
 *      it shows Revoked with the given reason.             (describe 1, test 3)
 *   D. Admin reissues a currently-issued certificate; the original flips
 *      to Revoked (history preserved, never deleted) and a new row with
 *      its own independent certificate number appears as Valid.
 *                                                          (describe 1, test 4)
 *   E. Student sees and downloads their own certificate (a working signed
 *      URL serving the real uploaded PDF bytes).            (describe 2, test 1)
 *   F. Student cannot access another Student's certificate — fully
 *      covered by supabase/tests/phase17_certificates_test.sql's own
 *      certificates_select_own/Storage denial assertions (no new
 *      certificate-specific URL surface exists beyond the already-tested
 *      enrollment-detail page itself, Phase 10's own existing suite), not
 *      re-tested through the browser here.
 *   G. Public /verify-certificate: a valid issued number shows Valid with
 *      the approved minimal fields; an unknown number shows "not found";
 *      a revoked number shows Revoked, never Valid.         (describe 3)
 *   H. Trainer has zero certificate access, anonymous/direct-tampering
 *      denial, immutability, sequential/unique numbering — fully covered
 *      by supabase/tests/phase17_certificates_test.sql, not re-tested here
 *      (brief's own "keep the browser suite concise, push security-heavy
 *      behavior to SQL/RLS/unit tests" instruction).
 *   I. Student/Admin Portal regression, no Trainer finance exposure —
 *      proven by re-running those phases' own existing suites during
 *      manual acceptance, not a new Phase 17 test.
 *
 * Every describe block owns its own Admin/Student identity, its own
 * (program, batch) pair lookup, and its own synthetic Enrollment/
 * Certificate rows — none depend on another describe block's beforeAll,
 * since the acceptance protocol runs tests ONE AT A TIME via `-g`
 * (`npx playwright test ... -g "<test name>"`), under which a sibling
 * describe block's beforeAll never runs at all. Every real Program/Batch
 * used is only ever READ (findExistingCertificateEligibleProgramWithBatch),
 * never mutated or deleted — only new, synthetic child rows
 * (Enrollment/Certificate) are created and exact-id/exact-object cleaned
 * up.
 */

test.describe.configure({ mode: "serial" });

const skipSuite = !hasRealSupabaseCredentials();

test.skip(
  skipSuite,
  "Phase 17 live E2E suite requires real dev Supabase credentials in .env.local " +
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

async function loginAsAdmin(page: Page, identity: Phase17AdminIdentity) {
  await login(page, "/login/admin", identity.email, identity.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

async function loginAsStudent(page: Page, identity: Phase17StudentPortalIdentity) {
  await login(page, "/login/student", identity.email, identity.password);
  await expect(page).toHaveURL(/\/student$/);
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: /^Welcome/, level: 1 })).toBeVisible();
  await assertSessionPersisted(page);
}

// "Certificates" is a shadcn CardTitle (a plain div, no ARIA heading role)
// — same scoped-card idiom as e2e/phase16-assignments.spec.ts's own
// assignmentsCardOn, for the identical reason (never match Next's own
// always-present route-announcer element via an unscoped getByRole("alert")).
function certificatesCardOn(page: Page) {
  return page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]:text-is("Certificates")'),
  });
}

async function runCleanupSteps(
  steps: Array<{ label: string; run: () => Promise<Phase17DeleteResult> }>,
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
// (A/B/C/D) Admin — issue / ineligible reason / revoke / reissue.

test.describe("Admin — Certificate management", () => {
  let admin: Phase17AdminIdentity | undefined;
  let student: Phase17StudentPortalIdentity | undefined;
  // A SEPARATE Student, owning the ineligible Enrollment. `enrollments_
  // one_per_student_batch` is a real, unweakened unique constraint on
  // (student_id, batch_id) — the eligible and ineligible Enrollments below
  // are both created against the SAME found Batch (findExistingCertificate
  // EligibleProgramWithBatch returns a single real dev-project pair, never
  // a synthetic one), so they cannot share one Student without colliding.
  // Each Enrollment therefore gets its own uniquely owned synthetic
  // Student, per the Phase 17 fixture-isolation principle — never a second
  // enrollment crammed onto the same (student, batch) pair.
  let ineligibleStudent: Phase17StudentPortalIdentity | undefined;
  let pair: ExistingCertificateEligibleProgramWithBatch | undefined;
  let eligibleEnrollmentId: string | undefined;
  let ineligibleEnrollmentId: string | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      admin = await createPhase17AdminIdentity("Admin");
    } catch (err) {
      if (err instanceof Phase17PartialAdminIdentityError) admin = err.partial;
      throw err;
    }
    try {
      student = await createPhase17StudentPortalIdentity("ForAdmin");
    } catch (err) {
      if (err instanceof Phase17PartialStudentPortalIdentityError) student = err.partial;
      throw err;
    }
    try {
      ineligibleStudent = await createPhase17StudentPortalIdentity("ForAdminIneligible");
    } catch (err) {
      if (err instanceof Phase17PartialStudentPortalIdentityError)
        ineligibleStudent = err.partial;
      throw err;
    }
    const found = await findExistingCertificateEligibleProgramWithBatch();
    if (!found) {
      throw new Error(
        "No existing certificate_eligible Program/Batch was found in the dev project.",
      );
    }
    pair = found;
    if (student.studentId) {
      // Eligible: completed + certificate_eligible (filtered above) +
      // total_payable 0 (so outstanding balance is 0 with zero payment
      // rows needed at all).
      eligibleEnrollmentId = await createPhase17SyntheticEnrollment({
        studentId: student.studentId,
        programId: pair.programId,
        batchId: pair.batchId,
        totalPayableRupees: 0,
        status: "completed",
      });
    }
    if (ineligibleStudent.studentId) {
      // Ineligible on two counts at once: not completed AND a real
      // outstanding balance (no payment exists against it) — its own
      // Student, same Batch, so it never collides with the eligible
      // Enrollment above.
      ineligibleEnrollmentId = await createPhase17SyntheticEnrollment({
        studentId: ineligibleStudent.studentId,
        programId: pair.programId,
        batchId: pair.batchId,
        totalPayableRupees: 15000,
        status: "active",
      });
    }
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: "Eligible enrollment's certificates",
        run: () =>
          eligibleEnrollmentId
            ? deletePhase17AllCertificatesForEnrollment(eligibleEnrollmentId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Eligible enrollment",
        run: () =>
          eligibleEnrollmentId
            ? deletePhase17SyntheticEnrollmentIfSafe(eligibleEnrollmentId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Ineligible enrollment",
        run: () =>
          ineligibleEnrollmentId
            ? deletePhase17SyntheticEnrollmentIfSafe(ineligibleEnrollmentId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Admin identity",
        run: () =>
          admin ? deletePhase17AdminIdentity(admin) : Promise.resolve({ ok: true }),
      },
      {
        label: "Student identity",
        run: () =>
          student
            ? deletePhase17StudentPortalIdentity(student)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Ineligible-enrollment student identity",
        run: () =>
          ineligibleStudent
            ? deletePhase17StudentPortalIdentity(ineligibleStudent)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("Admin sees an eligibility reason and no Issue form for an ineligible Enrollment", async ({
    page,
  }) => {
    if (!admin || !ineligibleEnrollmentId) throw new Error("Fixture setup incomplete.");

    await loginAsAdmin(page, admin);
    await page.goto(`/admin/enrollments/${ineligibleEnrollmentId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const card = certificatesCardOn(page);
    await expect(card).toBeVisible();
    await expect(card.getByText(/not completed/i)).toBeVisible();
    await expect(card.getByRole("button", { name: "Issue certificate" })).toHaveCount(0);
  });

  test("Admin issues, revokes, and reissues a certificate for an eligible Enrollment", async ({
    page,
  }) => {
    if (!admin || !eligibleEnrollmentId) throw new Error("Fixture setup incomplete.");

    await loginAsAdmin(page, admin);
    await page.goto(`/admin/enrollments/${eligibleEnrollmentId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const card = certificatesCardOn(page);
    await expect(card).toBeVisible();

    // --- A: Issue ---
    const completionDate = new Date().toISOString().slice(0, 10);
    await card.locator('input[name="completionDate"]').fill(completionDate);
    await card.getByRole("button", { name: "Issue certificate" }).click();
    await Promise.race([
      card.getByRole("alert").waitFor({ state: "visible" }),
      card.getByText("Certificate issued", { exact: true }).waitFor({ state: "visible" }),
    ]);
    await expect(card.getByRole("alert")).toHaveCount(0);
    await page.reload();

    const originalItem = card.locator("li").filter({ hasText: "Valid" });
    await expect(originalItem).toHaveCount(1);
    const originalNumberText = await originalItem
      .locator("span.font-medium")
      .first()
      .innerText();
    expect(originalNumberText.length).toBeGreaterThan(0);

    // Issue form must be gone now (alreadyIssued) — no second Issue
    // control for the same Enrollment.
    await expect(card.getByRole("button", { name: "Issue certificate" })).toHaveCount(0);

    // --- C: Revoke (standalone) ---
    await originalItem.getByRole("button", { name: "Revoke" }).click();
    await originalItem.locator('input[name="revokedReason"]').fill("E2E revoke reason");
    const confirmRevokeButton = originalItem.getByRole("button", {
      name: "Confirm revoke",
    });
    await confirmRevokeButton.click();
    // useActionState's formAction only resolves (re-enabling the button,
    // reverting its label from "Revoking...") once the server action's
    // whole round trip — including the DB update — has completed, so
    // waiting for that reversion (rather than a fixed delay) is what
    // actually guarantees the reload below reads post-revoke state.
    await expect(confirmRevokeButton).toBeEnabled({ timeout: 15000 });
    await page.reload();

    const revokedItem = card.locator("li").filter({ hasText: originalNumberText });
    await expect(revokedItem.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(revokedItem.getByText(/E2E revoke reason/)).toBeVisible();

    // --- D: Reissue a FRESH certificate, then prove reissue's own history
    // preservation on it (a revoked certificate cannot itself be
    // reissued — proven at the SQL layer, not here) ---
    await card.locator('input[name="completionDate"]').fill(completionDate);
    await card.getByRole("button", { name: "Issue certificate" }).click();
    await Promise.race([
      card.getByRole("alert").waitFor({ state: "visible" }),
      card.getByText("Certificate issued", { exact: true }).waitFor({ state: "visible" }),
    ]);
    await page.reload();

    const validItems = card.locator("li").filter({ hasText: "Valid" });
    await expect(validItems).toHaveCount(1);
    const secondNumberText = await validItems
      .first()
      .locator("span.font-medium")
      .first()
      .innerText();

    await validItems.first().getByRole("button", { name: "Reissue" }).click();
    await validItems.first().locator('input[name="reason"]').fill("E2E reissue reason");
    const confirmReissueButton = validItems
      .first()
      .getByRole("button", { name: "Confirm reissue" });
    await confirmReissueButton.click();
    await expect(confirmReissueButton).toBeEnabled({ timeout: 15000 });
    await page.reload();

    const nowRevokedSecond = card.locator("li").filter({ hasText: secondNumberText });
    await expect(nowRevokedSecond.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(
      nowRevokedSecond.getByText(/Replaced by reissued certificate/),
    ).toBeVisible();

    const stillValid = card.locator("li").filter({ hasText: "Valid" });
    await expect(stillValid).toHaveCount(1);
    const thirdNumberText = await stillValid
      .first()
      .locator("span.font-medium")
      .first()
      .innerText();
    expect(thirdNumberText).not.toBe(secondNumberText);
    expect(thirdNumberText).not.toBe(originalNumberText);
  });
});

// ---------------------------------------------------------------------------
// (E) Student — view and download own certificate.

test.describe("Student — Certificate view/download", () => {
  let student: Phase17StudentPortalIdentity | undefined;
  let pair: ExistingCertificateEligibleProgramWithBatch | undefined;
  let enrollmentId: string | undefined;
  let certificate: { id: string; certificateNumber: string; pdfPath: string } | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      student = await createPhase17StudentPortalIdentity("Viewer");
    } catch (err) {
      if (err instanceof Phase17PartialStudentPortalIdentityError) student = err.partial;
      throw err;
    }
    const found = await findExistingCertificateEligibleProgramWithBatch();
    if (!found) {
      throw new Error(
        "No existing certificate_eligible Program/Batch was found in the dev project.",
      );
    }
    pair = found;
    if (student.studentId) {
      enrollmentId = await createPhase17SyntheticEnrollment({
        studentId: student.studentId,
        programId: pair.programId,
        batchId: pair.batchId,
        totalPayableRupees: 0,
        status: "completed",
      });
      certificate = await createPhase17CertificateDirect({
        enrollmentId,
        studentId: student.studentId,
        programId: pair.programId,
        completionDate: new Date().toISOString().slice(0, 10),
      });
    }
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: "Certificate fixture",
        run: () =>
          certificate
            ? deletePhase17CertificateIfExists(certificate.id, certificate.pdfPath)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Enrollment",
        run: () =>
          enrollmentId
            ? deletePhase17SyntheticEnrollmentIfSafe(enrollmentId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Student identity",
        run: () =>
          student
            ? deletePhase17StudentPortalIdentity(student)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("Student sees their own certificate and downloads a working signed PDF", async ({
    page,
  }) => {
    if (!student || !enrollmentId || !certificate)
      throw new Error("Fixture setup incomplete.");

    await loginAsStudent(page, student);
    await page.goto(`/student/enrollments/${enrollmentId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const card = certificatesCardOn(page);
    await expect(card).toBeVisible();
    const item = card.locator("li").filter({ hasText: certificate.certificateNumber });
    await expect(item).toBeVisible();
    await expect(item.getByText("Valid", { exact: true })).toBeVisible();

    const popupPromise = page.waitForEvent("popup");
    await item.getByRole("button", { name: "Download" }).click();
    const popup = await popupPromise;

    const response = await popup.waitForEvent("response", {
      predicate: (r) => r.url().includes("/storage/v1/object/sign/certificates/"),
      timeout: 15000,
    });
    expect(response.status(), `signed URL request failed: ${response.url()}`).toBe(200);
    expect(response.headers()["content-type"] ?? "").toContain("application/pdf");

    const verification = await page.request.get(response.url());
    expect(verification.ok(), "independent re-fetch of the signed URL failed").toBe(true);
    const body = await verification.body();
    expect(
      body.equals(buildPhase17FixtureCertificatePdf()),
      "signed URL did not serve the exact uploaded fixture certificate PDF bytes",
    ).toBe(true);

    await popup.close().catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// (G) Public verification — no login at all.

test.describe("Public — Certificate verification", () => {
  let student: Phase17StudentPortalIdentity | undefined;
  let pair: ExistingCertificateEligibleProgramWithBatch | undefined;
  let enrollmentId: string | undefined;
  let issuedCert: { id: string; certificateNumber: string; pdfPath: string } | undefined;
  let revokedCert: { id: string; certificateNumber: string; pdfPath: string } | undefined;

  test.beforeAll(async () => {
    if (skipSuite) return;
    try {
      student = await createPhase17StudentPortalIdentity("Verify");
    } catch (err) {
      if (err instanceof Phase17PartialStudentPortalIdentityError) student = err.partial;
      throw err;
    }
    const found = await findExistingCertificateEligibleProgramWithBatch();
    if (!found) {
      throw new Error(
        "No existing certificate_eligible Program/Batch was found in the dev project.",
      );
    }
    pair = found;
    if (student.studentId) {
      enrollmentId = await createPhase17SyntheticEnrollment({
        studentId: student.studentId,
        programId: pair.programId,
        batchId: pair.batchId,
        totalPayableRupees: 0,
        status: "completed",
      });
      issuedCert = await createPhase17CertificateDirect({
        enrollmentId,
        studentId: student.studentId,
        programId: pair.programId,
        completionDate: new Date().toISOString().slice(0, 10),
      });
      revokedCert = await createPhase17CertificateDirect({
        enrollmentId,
        studentId: student.studentId,
        programId: pair.programId,
        completionDate: new Date().toISOString().slice(0, 10),
      });
    }
  });

  test.afterAll(async () => {
    if (skipSuite) return;
    await runCleanupSteps([
      {
        label: "Issued certificate fixture",
        run: () =>
          issuedCert
            ? deletePhase17CertificateIfExists(issuedCert.id, issuedCert.pdfPath)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Revoked certificate fixture",
        run: () =>
          revokedCert
            ? deletePhase17CertificateIfExists(revokedCert.id, revokedCert.pdfPath)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Enrollment",
        run: () =>
          enrollmentId
            ? deletePhase17SyntheticEnrollmentIfSafe(enrollmentId)
            : Promise.resolve({ ok: true }),
      },
      {
        label: "Student identity",
        run: () =>
          student
            ? deletePhase17StudentPortalIdentity(student)
            : Promise.resolve({ ok: true }),
      },
    ]);
  });

  test("Public verification page confirms a valid certificate, rejects an unknown number, and never shows a revoked certificate as valid", async ({
    page,
  }) => {
    if (!issuedCert || !revokedCert) throw new Error("Fixture setup incomplete.");

    // Mark the second fixture certificate revoked directly (this suite
    // only needs a real revoked row to verify against, not the UI revoke
    // flow itself — that is covered by the Admin describe block above).
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error: revokeError } = await supabase
      .from("certificates")
      .update({
        status: "revoked",
        revoked_reason: "E2E fixture",
        revoked_at: new Date().toISOString(),
      })
      .eq("id", revokedCert.id);
    if (revokeError)
      throw new Error(
        `Failed to mark fixture certificate revoked: ${revokeError.message}`,
      );

    await page.goto("/verify-certificate");
    await expect(
      page.getByRole("heading", { name: "Verify a certificate", level: 1 }),
    ).toBeVisible();

    // Valid.
    await page.locator("#certificateNumber").fill(issuedCert.certificateNumber);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(
      page.getByText(issuedCert.certificateNumber, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Valid", { exact: true })).toBeVisible();

    // Unknown.
    await page
      .locator("#certificateNumber")
      .fill(`${PHASE17_E2E_PREFIX}-NO-SUCH-${RUN_ID}`);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(
      page.getByText("No certificate was found with that number."),
    ).toBeVisible();

    // Revoked — must show Revoked, never Valid.
    await page.locator("#certificateNumber").fill(revokedCert.certificateNumber);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(
      page.getByText(revokedCert.certificateNumber, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(page.getByText("Valid", { exact: true })).toHaveCount(0);
  });
});
