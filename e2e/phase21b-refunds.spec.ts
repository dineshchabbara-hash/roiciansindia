import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  cleanupPhase21B,
  createPhase21BAdmin,
  createPhase21BEnrollment,
  createPhase21BStudent,
  findExistingProgramWithBatch,
  hasRazorpayTestConfig,
  hasRealSupabaseCredentials,
  insertAcceptedRazorpayRefund,
  insertPaidPayment,
  newPhase21BTracked,
  phase21bMarker,
  readEnrollmentTerms,
  readPaymentRow,
  readRefundAudit,
  readRefunds,
  signedRefundWebhook,
  syntheticId,
  type Phase21BAdmin,
  type Phase21BTracked,
} from "./support/phase21b-fixtures";

/**
 * Phase 21B (Refunds) acceptance — two independent tests, each with its own
 * synthetic Admin, student, enrollment and paid payment. The cap, RLS,
 * immutability and concurrency matrix is proven in
 * supabase/tests/phase21b_refunds_test.sql and
 * scripts/test-refund-concurrency.sh, not here.
 *
 *   1. Admin records a partial manual refund against an offline payment;
 *      refund history, the derived "Paid — Partially Refunded" label, the
 *      Enrollment Financial Position and the Phase 19 Financial report all
 *      reconcile; the payment and the enrollment's terms are unchanged.
 *   2. Razorpay TEST mode: the Admin's refund request is sent to Razorpay's
 *      real TEST API, which declines it for this synthetic payment — no
 *      financial truth, reservation released; then a refund Razorpay has
 *      accepted is confirmed by a signed `refund.processed` webhook,
 *      delivered twice, and results in exactly one processed refund.
 */

test.describe.configure({ mode: "serial" });

test.skip(
  !hasRealSupabaseCredentials(),
  "Phase 21B E2E requires dev Supabase credentials in .env.local.",
);

function adminNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin navigation" });
}

async function loginAdmin(page: Page, admin: Phase21BAdmin) {
  await page.goto("/login/admin");
  await page.locator("#email").fill(admin.email);
  await page.locator("#password").fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(adminNav(page)).toBeVisible();
  const cookieNames = (await page.context().cookies()).map((c) => c.name);
  expect(cookieNames.some((name) => /^sb-.+-auth-token(\.\d+)?$/.test(name))).toBe(true);
}

/** Leaves the dashboard by client-side navigation, then opens the payment. */
async function openPayment(page: Page, paymentId: string, paymentCode: string) {
  await adminNav(page).getByRole("link", { name: "Payments", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/payments$/);
  await page.goto(`/admin/payments/${paymentId}`);
  await expect(page.getByRole("heading", { name: paymentCode, level: 1 })).toBeVisible();
}

function refundsCard(page: Page): Locator {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole("heading", { name: "Refunds", exact: true }) });
}

function summaryValue(card: Locator, term: string): Locator {
  return card
    .locator('dl[aria-label="Refund summary"] dt', { hasText: new RegExp(`^${term}$`) })
    .locator("xpath=following-sibling::dd[1]");
}

function historyRows(card: Locator): Locator {
  return card.getByRole("table", { name: "Refund history" }).locator("tbody tr");
}

async function cleanup(tracked: Phase21BTracked) {
  const failures = await cleanupPhase21B(tracked);
  expect(
    failures,
    failures.length
      ? `Phase 21B cleanup failed — verify by exact id only:\n${failures.join("\n")}`
      : undefined,
  ).toEqual([]);
}

// ---------------------------------------------------------------------------

test.describe("Admin refunds part of an offline payment", () => {
  const tracked = newPhase21BTracked();
  const marker = phase21bMarker("Offline");
  let admin: Phase21BAdmin;
  let enrollment: { id: string; enrollmentCode: string };
  let payment: { id: string; paymentCode: string };

  test.beforeAll(async () => {
    admin = await createPhase21BAdmin(tracked, "Refunder");
    const student = await createPhase21BStudent(tracked, marker);
    const programBatch = await findExistingProgramWithBatch();
    if (!programBatch) throw new Error("No existing Batch was found on the dev project.");
    enrollment = await createPhase21BEnrollment(tracked, {
      studentId: student.id,
      programId: programBatch.programId,
      batchId: programBatch.batchId,
      totalPayable: "10000.00",
    });
    payment = await insertPaidPayment({
      enrollmentId: enrollment.id,
      studentId: student.id,
      amount: "10000.00",
      method: "cash",
      adminProfileId: admin.profileId!,
    });
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  test("a partial manual refund reconciles with the enrollment and the Financial report", async ({
    page,
  }) => {
    // One sign-in, four page loads and one refund against the remote dev
    // project. The comparable Phase 20A Windows run measured ~34.5s for two
    // sign-ins + two recordings + four ledger loads; this test gets the same
    // 60s ceiling and every assertion keeps its default timeout.
    test.setTimeout(60_000);
    const paymentBefore = await readPaymentRow(payment.id);
    const termsBefore = await readEnrollmentTerms(enrollment.id);

    await loginAdmin(page, admin);
    await openPayment(page, payment.id, payment.paymentCode);

    const card = refundsCard(page);
    await expect(summaryValue(card, "Refundable")).toHaveText("₹10,000.00");
    const form = card.getByRole("form", { name: "Refund payment" });
    await expect(form).toContainText(
      "It does not reduce the student's fee or total payable",
    );
    await form.getByLabel("Refund amount (₹)").fill("2000.00");
    await form.getByLabel("Reason").fill(`${marker} course downgrade`);
    await form.getByLabel("Reference (optional)").fill(`${marker}-UTR`);
    const preview = form.locator('dl[aria-label="Outstanding balance"]');
    await expect(preview).toContainText("Outstanding now₹0.00");
    await expect(preview).toContainText("Outstanding after this refund₹2,000.00");
    await form.getByRole("button", { name: "Record refund" }).click();

    // History, summary and the derived label (the stored status stays paid).
    await expect(historyRows(card)).toHaveCount(1);
    await expect(historyRows(card).first()).toContainText("₹2,000.00");
    await expect(historyRows(card).first()).toContainText("Refunded");
    await expect(historyRows(card).first()).toContainText(`${marker}-UTR`);
    await expect(summaryValue(card, "Refunded")).toHaveText("₹2,000.00");
    await expect(summaryValue(card, "Refundable")).toHaveText("₹8,000.00");
    await expect(
      page.getByText("Paid — Partially Refunded", { exact: true }),
    ).toBeVisible();

    const refunds = await readRefunds(payment.id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      status: "processed",
      reference: `${marker}-UTR`,
      razorpay_refund_id: null,
    });
    expect(Number(refunds[0].amount)).toBe(2000);
    expect(await readRefundAudit(refunds[0].id)).toEqual([
      expect.objectContaining({ action: "refund.recorded_offline", actor_role: "admin" }),
    ]);
    // A refund is not a fee adjustment: payment and terms are untouched.
    expect(await readPaymentRow(payment.id)).toEqual(paymentBefore);
    expect(await readEnrollmentTerms(enrollment.id)).toEqual(termsBefore);

    // Phase 19 Financial report: payable, paid, refunded, outstanding.
    await page.goto(`/admin/reports/financial?q=${marker}`);
    await expect(
      page.getByRole("heading", { name: "Financial report", level: 1 }),
    ).toBeVisible();
    const reportRow = page
      .getByRole("table", { name: "Financial report" })
      .locator("tbody tr");
    await expect(reportRow).toHaveCount(1);
    const cells = await reportRow.first().locator("td").allTextContents();
    expect(cells[0]).toBe(enrollment.enrollmentCode);
    expect(cells.slice(7)).toEqual([
      "₹10,000.00",
      "₹10,000.00",
      "₹2,000.00",
      "₹2,000.00",
    ]);

    // Phase 14 Enrollment Financial Position (whole-rupee display there).
    await page.goto(`/admin/enrollments/${enrollment.id}`);
    const position = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText("Financial Position", { exact: true }) });
    const figure = (label: string) =>
      position.getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]");
    await expect(figure("Total payable")).toHaveText("₹10,000");
    await expect(figure("Total paid")).toHaveText("₹10,000");
    await expect(figure("Total refunded")).toHaveText("₹2,000");
    await expect(figure("Outstanding")).toHaveText("₹2,000");
  });
});

test.describe("Razorpay TEST refund: declined request and confirmed refund", () => {
  test.skip(
    !hasRazorpayTestConfig(),
    "Requires TEST-mode Razorpay keys and the webhook secret in .env.local.",
  );

  const tracked = newPhase21BTracked();
  const marker = phase21bMarker("Online");
  let admin: Phase21BAdmin;
  let enrollment: { id: string; enrollmentCode: string };
  let payment: { id: string; paymentCode: string; providerPaymentId: string | null };
  let acceptedRefundId: string;
  const providerRefundId = syntheticId("rfnd", "A");

  test.beforeAll(async () => {
    admin = await createPhase21BAdmin(tracked, "OnlineRefunder");
    const student = await createPhase21BStudent(tracked, marker);
    const programBatch = await findExistingProgramWithBatch();
    if (!programBatch) throw new Error("No existing Batch was found on the dev project.");
    enrollment = await createPhase21BEnrollment(tracked, {
      studentId: student.id,
      programId: programBatch.programId,
      batchId: programBatch.batchId,
      totalPayable: "3000.00",
    });
    payment = await insertPaidPayment({
      enrollmentId: enrollment.id,
      studentId: student.id,
      amount: "3000.00",
      method: "razorpay",
      providerBlock: "A",
    });
    acceptedRefundId = await insertAcceptedRazorpayRefund({
      paymentId: payment.id,
      amount: "1000.00",
      providerRefundId,
      adminProfileId: admin.profileId!,
    });
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  test("a declined request records nothing; a signed refund.processed counts exactly once", async ({
    page,
    request,
  }) => {
    // One sign-in, a real Razorpay TEST API round trip, two webhook
    // deliveries and three page loads. The comparable Phase 20B Test 1 ran
    // ~39.2s on Windows including its hooks; 60s ceiling, default
    // assertion timeouts.
    test.setTimeout(60_000);
    await loginAdmin(page, admin);
    await openPayment(page, payment.id, payment.paymentCode);

    const card = refundsCard(page);
    await expect(summaryValue(card, "In progress")).toHaveText("₹1,000.00");
    await expect(summaryValue(card, "Refundable")).toHaveText("₹2,000.00");

    // 1. Admin asks Razorpay (TEST API) to refund ₹500. The payment id is
    //    synthetic, so Razorpay declines: nothing is refunded and the
    //    reservation is released.
    const form = card.getByRole("form", { name: "Refund payment" });
    await expect(form).toContainText("once Razorpay confirms the refund.");
    await form.getByLabel("Refund amount (₹)").fill("500.00");
    await form.getByLabel("Reason").fill(`${marker} declined`);
    await form.getByRole("button", { name: "Refund via Razorpay" }).click();
    await expect(form.getByRole("alert")).toHaveText(
      "Razorpay declined this refund. No money was refunded.",
    );
    await expect(historyRows(card).filter({ hasText: "Failed" })).toHaveCount(1);
    await expect(summaryValue(card, "Refunded")).toHaveText("₹0.00");
    await expect(summaryValue(card, "Refundable")).toHaveText("₹2,000.00");

    // 2. Razorpay confirms the accepted ₹1,000 refund — delivered twice.
    const { body, signature } = signedRefundWebhook({
      event: "refund.processed",
      providerRefundId,
      providerPaymentId: payment.providerPaymentId!,
      amountPaise: 100000,
      refundId: acceptedRefundId,
    });
    for (const eventId of [
      `evt_${providerRefundId}_1`,
      `evt_${providerRefundId}_1`,
      `evt_${providerRefundId}_2`,
    ]) {
      const response = await request.post("/api/razorpay/webhook", {
        data: body,
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": signature,
          "x-razorpay-event-id": eventId,
        },
      });
      expect(response.status()).toBe(200);
    }

    const refunds = await readRefunds(payment.id);
    expect(refunds.map((r) => [Number(r.amount), r.status])).toEqual([
      [1000, "processed"],
      [500, "failed"],
    ]);
    expect(
      (await readRefundAudit(acceptedRefundId)).filter(
        (a) => a.action === "refund.processed",
      ),
    ).toHaveLength(1);
    expect((await readPaymentRow(payment.id)).status).toBe("paid");

    await page.reload();
    await expect(summaryValue(card, "Refunded")).toHaveText("₹1,000.00");
    await expect(summaryValue(card, "In progress")).toHaveText("₹0.00");
    await expect(summaryValue(card, "Refundable")).toHaveText("₹2,000.00");
    await expect(
      page.getByText("Paid — Partially Refunded", { exact: true }),
    ).toBeVisible();

    // Phase 14: payable 3,000 − paid 3,000 + processed refund 1,000.
    await page.goto(`/admin/enrollments/${enrollment.id}`);
    const position = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText("Financial Position", { exact: true }) });
    await expect(
      position
        .getByText("Outstanding", { exact: true })
        .locator("xpath=following-sibling::p[1]"),
    ).toHaveText("₹1,000");
  });
});
