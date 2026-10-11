import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  hasRazorpayTestConfig,
  hasRealSupabaseCredentials,
  cleanupPhase20B,
  createPhase20BEnrollment,
  createPhase20BStudent,
  findExistingProgramWithBatch,
  newPhase20BTracked,
  readEnrollmentOrders,
  readEnrollmentPayments,
  readPaymentAudit,
  readWebhookEvents,
  signedCapturedWebhook,
  syntheticPaymentId,
  type Phase20BStudent,
  type Phase20BTracked,
} from "./support/phase20b-fixtures";

/**
 * Phase 20B (Razorpay TEST MODE) acceptance suite — two independent tests,
 * each with its own synthetic Student and enrollment.
 *
 *   1. A Student starts an online payment; the app creates a REAL Razorpay
 *      Test Mode order; Razorpay's confirmation arrives as a signed
 *      `payment.captured` webhook (delivered three times: original,
 *      redelivery, and a second event for the same payment). Exactly one
 *      paid ledger row and one audit entry result, and the Student's Phase
 *      14 balance and next payment options update.
 *   2. A cancelled Checkout and a forged Checkout "success" (bad
 *      signature) create no ledger row; a repeat Pay click reuses the open
 *      order.
 *
 * Razorpay's hosted Checkout window itself is not driven: only its script
 * (checkout.razorpay.com/v1/checkout.js) is replaced in the browser by a
 * stub that records the options the app passes and lets the test trigger
 * dismiss / handler. Order creation and every server check run for real.
 * Completing a real test-card payment in the hosted window is a separate
 * manual Test Mode check (see IMPLEMENTATION_PLAN.md Phase 20B).
 *
 * Requires .env.local with dev Supabase credentials plus TEST-mode
 * RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET;
 * skipped, not failed, otherwise. No live key is ever accepted by the app.
 */

test.describe.configure({ mode: "serial" });

test.skip(
  !hasRealSupabaseCredentials() || !hasRazorpayTestConfig(),
  "Phase 20B E2E requires dev Supabase credentials and TEST-mode Razorpay keys + webhook secret in .env.local.",
);

const CHECKOUT_STUB = `
  window.__rzp = { opened: 0 };
  window.Razorpay = class {
    constructor(options) { window.__rzp.options = options; }
    on(event, handler) { if (event === "payment.failed") window.__rzp.failed = handler; }
    open() { window.__rzp.opened += 1; }
  };
`;

async function stubCheckout(page: Page) {
  await page.route("https://checkout.razorpay.com/v1/checkout.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: CHECKOUT_STUB,
    }),
  );
}

async function checkoutOptions(page: Page) {
  await page.waitForFunction(() => {
    const w = window as unknown as { __rzp?: { opened: number } };
    return (w.__rzp?.opened ?? 0) > 0;
  });
  return page.evaluate(() => {
    const w = window as unknown as {
      __rzp: {
        options: { key: string; order_id: string; amount: number; currency: string };
      };
    };
    const { key, order_id, amount, currency } = w.__rzp.options;
    return { key, orderId: order_id, amount, currency };
  });
}

function studentNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Student navigation" });
}

async function login(page: Page, student: Phase20BStudent) {
  await page.goto("/login/student");
  await page.locator("#email").fill(student.email);
  await page.locator("#password").fill(student.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/student$/);
  // The Student home has no streaming boundary; its shell arrives once all
  // its data has loaded (measured 3.6–4.7s on Windows in Phase 19).
  await expect(studentNav(page)).toBeVisible({ timeout: 15_000 });
  const cookieNames = (await page.context().cookies()).map((c) => c.name);
  expect(cookieNames.some((name) => /^sb-.+-auth-token(\.\d+)?$/.test(name))).toBe(true);
}

// Next.js renders a hidden route announcer with role="alert", so status /
// alert messages are always looked up inside the Pay online card.
function payCard(page: Page): Locator {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText("Pay online", { exact: true }) });
}

async function openEnrollment(page: Page, enrollmentId: string) {
  await page.goto(`/student/enrollments/${enrollmentId}`);
  await expect(page.getByText("Pay online", { exact: true })).toBeVisible();
}

async function cleanup(tracked: Phase20BTracked) {
  const failures = await cleanupPhase20B(tracked);
  expect(
    failures,
    failures.length
      ? `Phase 20B cleanup failed — verify by exact id only:\n${failures.join("\n")}`
      : undefined,
  ).toEqual([]);
}

// ---------------------------------------------------------------------------

test.describe("Student pays online and the webhook reconciles once", () => {
  const tracked = newPhase20BTracked();
  let student: Phase20BStudent;
  let enrollmentId: string;

  test.beforeAll(async () => {
    student = await createPhase20BStudent(tracked, "Payer");
    const programBatch = await findExistingProgramWithBatch();
    if (!programBatch) throw new Error("No existing Batch was found on the dev project.");
    const enrollment = await createPhase20BEnrollment(tracked, {
      studentId: student.studentId!,
      programId: programBatch.programId,
      batchId: programBatch.batchId,
      totalPayable: "5000.00",
      installments: ["2000.00", "3000.00"],
    });
    enrollmentId = enrollment.id;
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  test("signed payment.captured records one paid payment and updates the balance", async ({
    page,
    request,
  }) => {
    await stubCheckout(page);
    await login(page, student);
    await openEnrollment(page, enrollmentId);

    await expect(
      page.getByRole("button", { name: "Pay full outstanding balance — ₹5,000.00" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Pay next installment (Installment 1) — ₹2,000.00" })
      .click();

    // The browser received a real Razorpay TEST order for the server-derived amount.
    const options = await checkoutOptions(page);
    expect(options.key).toMatch(/^rzp_test_/);
    expect(options.orderId).toMatch(/^order_/);
    expect(options).toMatchObject({ amount: 200000, currency: "INR" });

    const paymentId = syntheticPaymentId("A");
    const { body, signature } = signedCapturedWebhook({
      orderId: options.orderId,
      paymentId,
      amountPaise: 200000,
    });
    for (const eventId of [
      `evt_${paymentId}_1`,
      `evt_${paymentId}_1`,
      `evt_${paymentId}_2`,
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

    const payments = await readEnrollmentPayments(enrollmentId);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      method: "razorpay",
      status: "paid",
      razorpay_order_id: options.orderId,
      razorpay_payment_id: paymentId,
      created_by: null,
    });
    expect(Number(payments[0].total_amount)).toBe(2000);
    const audit = await readPaymentAudit(payments[0].id);
    expect(audit.map((a) => a.action)).toEqual(["payment.recorded_online"]);
    const events = await readWebhookEvents(options.orderId);
    expect(events.map((e) => e.outcome).sort()).toEqual(["already_recorded", "recorded"]);
    const orders = await readEnrollmentOrders(enrollmentId);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: "paid", purpose: "next_installment" });

    // Phase 14 figures on the Student page moved by exactly ₹2,000.
    await page.reload();
    await expect(page.getByText("Pay online", { exact: true })).toBeVisible();
    const outstanding = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText("Payment status", { exact: true }) })
      .getByText("Outstanding", { exact: true })
      .locator("xpath=following-sibling::p[1]");
    await expect(outstanding).toHaveText("₹3,000");
    // Installment 1 is now covered; Installment 2 equals the balance, so
    // only the full-balance option remains.
    await expect(
      page.getByRole("button", { name: "Pay full outstanding balance — ₹3,000.00" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Pay next installment/ })).toHaveCount(
      0,
    );
  });
});

test.describe("Cancelled or forged Checkout records nothing", () => {
  const tracked = newPhase20BTracked();
  let student: Phase20BStudent;
  let enrollmentId: string;

  test.beforeAll(async () => {
    student = await createPhase20BStudent(tracked, "Canceller");
    const programBatch = await findExistingProgramWithBatch();
    if (!programBatch) throw new Error("No existing Batch was found on the dev project.");
    const enrollment = await createPhase20BEnrollment(tracked, {
      studentId: student.studentId!,
      programId: programBatch.programId,
      batchId: programBatch.batchId,
      totalPayable: "1500.00",
    });
    enrollmentId = enrollment.id;
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  test("dismissed and bad-signature results leave the ledger untouched", async ({
    page,
  }) => {
    await stubCheckout(page);
    await login(page, student);
    await openEnrollment(page, enrollmentId);

    const pay = page.getByRole("button", {
      name: "Pay full outstanding balance — ₹1,500.00",
    });
    await pay.click();
    const first = await checkoutOptions(page);
    expect(first).toMatchObject({ amount: 150000, currency: "INR" });

    await page.evaluate(() => {
      const w = window as unknown as {
        __rzp: { options: { modal: { ondismiss: () => void } } };
      };
      w.__rzp.options.modal.ondismiss();
    });
    await expect(payCard(page).getByRole("status")).toHaveText(
      "Payment cancelled. You have not been charged.",
    );

    // A second click reuses the still-open order (no new Razorpay order).
    await pay.click();
    await page.waitForFunction(() => {
      const w = window as unknown as { __rzp: { opened: number } };
      return w.__rzp.opened >= 2;
    });
    const second = await checkoutOptions(page);
    expect(second.orderId).toBe(first.orderId);

    // A forged "success" (signature not made with our key secret).
    await page.evaluate(
      ({ orderId }) => {
        const w = window as unknown as {
          __rzp: { options: { handler: (r: Record<string, string>) => void } };
        };
        w.__rzp.options.handler({
          razorpay_order_id: orderId,
          razorpay_payment_id: "pay_FORGED123",
          razorpay_signature: "0".repeat(64),
        });
      },
      { orderId: first.orderId },
    );
    await expect(payCard(page).getByRole("alert")).toContainText(
      "We could not confirm this payment.",
    );

    expect(await readEnrollmentPayments(enrollmentId)).toEqual([]);
    const orders = await readEnrollmentOrders(enrollmentId);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: "created", payment_id: null });
  });
});
