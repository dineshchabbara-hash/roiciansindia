import { readFile } from "node:fs/promises";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { pdfText } from "./support/pdf-text";
import {
  cleanupPhase21A,
  countReceiptsForPayment,
  createPhase21AAdmin,
  createPhase21AEnrollment,
  createPhase21AStudent,
  createPhase21AStudentLogin,
  findExistingProgramWithBatch,
  hasRazorpayWebhookSecret,
  hasRealSupabaseCredentials,
  insertForeignPaidPayment,
  newPhase21ATracked,
  phase21aMarker,
  readEnrollmentPayments,
  readPaymentReceipt,
  readReceiptAudit,
  registerSyntheticOrder,
  signedCapturedWebhook,
  syntheticOrderId,
  syntheticPaymentId,
  type Phase21AIdentity,
  type Phase21ATracked,
} from "./support/phase21a-fixtures";

/**
 * Phase 21A (Receipts & Payment Documents) acceptance — two independent
 * tests, each with its own synthetic identities and enrollments. The
 * RLS / storage / numbering / concurrency matrix is proven in
 * supabase/tests/phase21a_receipts_test.sql and
 * scripts/test-receipt-issuance-concurrency.sh, not here.
 *
 *   1. An Admin records an offline payment through the real UI; the
 *      payment page shows its one receipt number at once, the PDF is
 *      generated after the response, downloads and prints the canonical
 *      payment; downloading again creates nothing new.
 *   2. A Student's Razorpay payment (synthetic order + signed webhook, no
 *      Razorpay API call) gets the same kind of receipt; the Student
 *      downloads their own, cannot download another Student's (and that
 *      request generates nothing for it), and an anonymous request is
 *      refused.
 *
 * Requires .env.local with dev Supabase credentials; Test 2 also needs
 * RAZORPAY_WEBHOOK_SECRET (skipped, not failed, otherwise).
 */

test.describe.configure({ mode: "serial" });

test.skip(
  !hasRealSupabaseCredentials(),
  "Phase 21A E2E requires dev Supabase credentials in .env.local.",
);

const RECEIPT_NUMBER = /^REC-\d{4}-\d{6,}$/;

function adminNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin navigation" });
}

function studentNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Student navigation" });
}

async function expectSessionCookie(page: Page) {
  const cookieNames = (await page.context().cookies()).map((c) => c.name);
  expect(cookieNames.some((name) => /^sb-.+-auth-token(\.\d+)?$/.test(name))).toBe(true);
}

async function loginAdmin(page: Page, admin: Phase21AIdentity) {
  await page.goto("/login/admin");
  await page.locator("#email").fill(admin.email);
  await page.locator("#password").fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(adminNav(page)).toBeVisible();
  await expectSessionCookie(page);
}

async function loginStudent(page: Page, student: Phase21AIdentity) {
  await page.goto("/login/student");
  await page.locator("#email").fill(student.email);
  await page.locator("#password").fill(student.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/student$/);
  // The Student home has no streaming boundary (measured 3.6–4.7s on
  // Windows in Phase 19).
  await expect(studentNav(page)).toBeVisible({ timeout: 15_000 });
  await expectSessionCookie(page);
}

function receiptCard(page: Page): Locator {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole("heading", { name: "Receipt", exact: true }) });
}

function definition(scope: Locator, term: string): Locator {
  return scope
    .locator("dt", { hasText: new RegExp(`^${term}$`) })
    .locator("xpath=following-sibling::dd[1]");
}

async function downloadPdf(page: Page, link: Locator): Promise<Buffer> {
  const downloadPromise = page.waitForEvent("download");
  await link.click();
  const download = await downloadPromise;
  const path = await download.path();
  return readFile(path);
}

async function cleanup(tracked: Phase21ATracked) {
  const failures = await cleanupPhase21A(tracked);
  expect(
    failures,
    failures.length
      ? `Phase 21A cleanup failed — verify by exact id only:\n${failures.join("\n")}`
      : undefined,
  ).toEqual([]);
}

// ---------------------------------------------------------------------------

test.describe("Admin records an offline payment and gets its receipt", () => {
  const tracked = newPhase21ATracked();
  let admin: Phase21AIdentity;
  let enrollment: { id: string; enrollmentCode: string };
  let payer: { id: string; studentCode: string; name: string };

  test.beforeAll(async () => {
    admin = await createPhase21AAdmin(tracked, "Recorder");
    payer = await createPhase21AStudent(tracked, "Offline");
    const programBatch = await findExistingProgramWithBatch();
    if (!programBatch) throw new Error("No existing Batch was found on the dev project.");
    enrollment = await createPhase21AEnrollment(tracked, {
      studentId: payer.id,
      programId: programBatch.programId,
      batchId: programBatch.batchId,
      totalPayable: "5000.00",
    });
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  test("a recorded cash payment has one receipt whose PDF matches the payment", async ({
    page,
  }) => {
    // One sign-in, one recording (the first PDF render of the server
    // process happens right after it), three payment-page loads and two PDF
    // downloads against the remote dev project. The comparable Phase 20A
    // Windows run measured ~34.5s for two sign-ins + two recordings + four
    // ledger loads; this test gets the same 60s ceiling and every assertion
    // keeps its default timeout.
    test.setTimeout(60_000);
    const reference = phase21aMarker("CASH");

    await loginAdmin(page, admin);
    await adminNav(page).getByRole("link", { name: "Payments", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/payments$/);
    await page.getByRole("link", { name: "Record offline payment" }).click();
    await expect(page).toHaveURL(/\/admin\/payments\/new$/);
    const lookup = page.getByRole("form", { name: "Find enrollment" });
    await lookup.getByLabel("Enrollment code").fill(enrollment.enrollmentCode);
    await lookup.getByRole("button", { name: "Find enrollment" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/payments/new\\?enrollment=${enrollment.enrollmentCode}$`),
    );

    const form = page.getByRole("form", { name: "Record offline payment" });
    await form.getByLabel("Amount received (₹)").fill("1500.00");
    await form.getByLabel("Payment method").selectOption({ label: "Cash" });
    await form.getByLabel("Reference (optional)").fill(reference);
    await form.getByRole("button", { name: "Record payment" }).click();

    await expect(page).toHaveURL(/\/admin\/payments\/[0-9a-f-]{36}\?recorded=1$/);
    const paymentId = new URL(page.url()).pathname.split("/").pop() as string;
    const paymentCode =
      (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
    expect(paymentCode).toMatch(/^PAY-\d{6,}$/);

    // The receipt number is reserved before the redirect, so the payment
    // page shows exactly the number the database issued straight away.
    const card = receiptCard(page);
    const shownNumber = (await definition(card, "Receipt number").textContent()) ?? "";
    expect(shownNumber).toMatch(RECEIPT_NUMBER);

    // The PDF is generated after the response (never in the redirect's way).
    await expect
      .poll(async () => (await readPaymentReceipt(paymentId))?.pdf_generated_at ?? null)
      .not.toBeNull();
    const receipt = await readPaymentReceipt(paymentId);
    expect(receipt).not.toBeNull();
    expect(receipt!.receipt_number).toBe(shownNumber);
    await page.reload();
    await expect(definition(card, "Document")).toHaveText("PDF ready");
    expect(await readReceiptAudit(receipt!.id)).toEqual([
      expect.objectContaining({
        action: "receipt.issued",
        actor_role: "system",
        after_data: expect.objectContaining({
          receiptNumber: shownNumber,
          paymentCode,
          amount: "1500.00",
          method: "cash",
        }),
      }),
    ]);

    // The PDF prints the canonical payment, from trusted rows only.
    const text = pdfText(
      await downloadPdf(page, card.getByRole("link", { name: "Download receipt" })),
    );
    for (const expected of [
      `Receipt No. ${shownNumber}`,
      paymentCode,
      payer.name,
      payer.studentCode,
      enrollment.enrollmentCode,
      "Offline",
      "Cash",
      reference,
      "INR 1,500.00",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain(paymentId);
    expect(text).not.toContain(receipt!.pdf_path);

    // Repeating the action reuses the same receipt: no second row, no
    // second number, no second audit entry.
    await page.reload();
    await expect(definition(receiptCard(page), "Receipt number")).toHaveText(shownNumber);
    const again = pdfText(
      await downloadPdf(
        page,
        receiptCard(page).getByRole("link", { name: "Download receipt" }),
      ),
    );
    expect(again).toContain(`Receipt No. ${shownNumber}`);
    expect(await countReceiptsForPayment(paymentId)).toBe(1);
    expect(await readReceiptAudit(receipt!.id)).toHaveLength(1);
    expect((await readPaymentReceipt(paymentId))?.receipt_number).toBe(shownNumber);
  });
});

test.describe("Student downloads their own Razorpay receipt only", () => {
  test.skip(
    !hasRazorpayWebhookSecret(),
    "Requires RAZORPAY_WEBHOOK_SECRET in .env.local to sign the test webhook.",
  );

  const tracked = newPhase21ATracked();
  let student: Phase21AIdentity;
  let enrollmentId: string;
  let enrollmentCode: string;
  let foreign: {
    paymentId: string;
    receipt: { id: string; pdf_generated_at: string | null };
  };

  test.beforeAll(async () => {
    student = await createPhase21AStudentLogin(tracked, "Online");
    const other = await createPhase21AStudentLogin(tracked, "Other");
    const programBatch = await findExistingProgramWithBatch();
    if (!programBatch) throw new Error("No existing Batch was found on the dev project.");
    const own = await createPhase21AEnrollment(tracked, {
      studentId: student.profileId!,
      programId: programBatch.programId,
      batchId: programBatch.batchId,
      totalPayable: "1200.00",
    });
    enrollmentId = own.id;
    enrollmentCode = own.enrollmentCode;
    const otherEnrollment = await createPhase21AEnrollment(tracked, {
      studentId: other.profileId!,
      programId: programBatch.programId,
      batchId: programBatch.batchId,
      totalPayable: "900.00",
    });
    foreign = await insertForeignPaidPayment({
      enrollmentId: otherEnrollment.id,
      studentId: other.profileId!,
      amount: "900.00",
    });
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  test("a webhook-confirmed payment gets a receipt only its Student can download", async ({
    page,
    request,
  }) => {
    // One Student sign-in, a webhook round trip, a wait for the receipt
    // (issued after the webhook response, first PDF render of the server
    // process) and three downloads. The comparable Phase 20B Test 1 ran
    // ~39.2s on Windows including its hooks; this test gets a 60s ceiling
    // and every assertion keeps its default timeout.
    test.setTimeout(60_000);
    const orderId = syntheticOrderId("A");
    const providerPaymentId = syntheticPaymentId("A");
    await registerSyntheticOrder({
      orderId,
      enrollmentId,
      studentId: student.profileId!,
      studentAuthUserId: student.authUserId,
      amount: "1200.00",
    });

    // Razorpay's confirmation: the only success signal, verified by the app.
    const { body, signature } = signedCapturedWebhook({
      orderId,
      paymentId: providerPaymentId,
      amountPaise: 120000,
    });
    const webhook = await request.post("/api/razorpay/webhook", {
      data: body,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": `evt_${providerPaymentId}`,
      },
    });
    expect(webhook.status()).toBe(200);

    const [payment] = await readEnrollmentPayments(enrollmentId);
    expect(payment).toMatchObject({
      method: "razorpay",
      status: "paid",
      razorpay_payment_id: providerPaymentId,
    });
    // Issued after the webhook response (never from the browser).
    await expect
      .poll(async () => (await readPaymentReceipt(payment.id))?.pdf_generated_at ?? null)
      .not.toBeNull();
    const receipt = (await readPaymentReceipt(payment.id))!;
    expect(receipt.receipt_number).toMatch(RECEIPT_NUMBER);

    await loginStudent(page, student);
    await page.goto(`/student/enrollments/${enrollmentId}`);
    const list = page.getByRole("list", { name: "Payments and receipts" });
    const item = list.getByRole("listitem").filter({ hasText: payment.payment_code });
    await expect(item).toContainText(`Receipt ${receipt.receipt_number}`);

    const text = pdfText(
      await downloadPdf(
        page,
        item.getByRole("link", { name: `Download receipt for ${payment.payment_code}` }),
      ),
    );
    for (const expected of [
      `Receipt No. ${receipt.receipt_number}`,
      payment.payment_code,
      enrollmentCode,
      "Online (Razorpay)",
      providerPaymentId,
      "INR 1,200.00",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain(orderId);

    // Another Student's payment id answers exactly like an unknown one, and
    // the request triggers nothing for that receipt.
    const crossAccess = await page.request.get(
      `/api/payments/${foreign.paymentId}/receipt`,
    );
    expect(crossAccess.status()).toBe(404);
    expect(crossAccess.headers()["content-type"]).not.toContain("application/pdf");
    expect((await readPaymentReceipt(foreign.paymentId))?.pdf_generated_at ?? null).toBe(
      foreign.receipt.pdf_generated_at,
    );
    expect(await countReceiptsForPayment(foreign.paymentId)).toBe(1);

    // No session, no document.
    const anonymous = await request.get(`/api/payments/${payment.id}/receipt`);
    expect(anonymous.status()).toBe(401);

    expect(await countReceiptsForPayment(payment.id)).toBe(1);
  });
});
