import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  hasRealSupabaseCredentials,
  cleanupPhase20,
  countPaymentsForEnrollment,
  createPhase20Admin,
  createPhase20Enrollment,
  createPhase20Student,
  findExistingProgramWithBatch,
  newPhase20Tracked,
  Phase20PartialIdentityError,
  phase20Marker,
  readPaymentAuditEntries,
  type ExistingProgramWithBatch,
  type Phase20Admin,
  type Phase20Enrollment,
  type Phase20Student,
  type Phase20Tracked,
} from "./support/phase20-fixtures";

/**
 * Phase 20A (Offline Payments Ledger) acceptance suite, run against the
 * real dev Supabase project through the running app. Two independent
 * describe blocks; each owns its own synthetic Admin, student and
 * enrollment (no shared state, no ordering dependency), so each test can
 * run on its own with `-g`.
 *
 *   1. An Admin records an offline payment against the right enrollment;
 *      it appears in the Payments ledger, is audited once, and the Phase 19
 *      Financial report and the Phase 14 Enrollment Financial Position both
 *      move by exactly that amount.
 *   2. An Admin records a back-dated payment with paise, cannot record more
 *      than the remaining balance, and after a fresh sign-in finds the
 *      payment again through the ledger filters and opens its read-only page.
 *
 * Authorization of Trainers/Students/anon (no Admin Payments access, no
 * write path, no financial reads) is proven in
 * supabase/tests/phase20_offline_payments_test.sql and the action/data unit
 * tests rather than repeated here; the /admin route gate itself is
 * pre-existing and covered by earlier phases.
 *
 * Every payment is recorded by a real signed-in Admin browser session; the
 * service role only creates/removes this suite's own synthetic rows and
 * reads the audit entry. Assertions wait on durable, server-rendered state
 * (URL, headings, table cells, definition lists) — never a sleep, a toast,
 * or response.finished().
 */

test.describe.configure({ mode: "serial" });

test.skip(
  !hasRealSupabaseCredentials(),
  "Phase 20A live E2E suite requires real dev Supabase credentials in .env.local " +
    "(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY). " +
    "Skipped, not failed, without a live dev project.",
);

// ---------------------------------------------------------------------------
// Shared helpers.

function adminNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin navigation" });
}

async function login(page: Page, admin: Phase20Admin) {
  await page.goto("/login/admin");
  await page.locator("#email").fill(admin.email);
  await page.locator("#password").fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Authentication evidence only: the Admin home URL, the Dashboard heading
  // and Admin navigation (rendered only by the role-gated layout), and the
  // Supabase session cookie. Never greeting text.
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(adminNav(page)).toBeVisible();
  const cookieNames = (await page.context().cookies()).map((c) => c.name);
  expect(cookieNames.some((name) => /^sb-.+-auth-token(\.\d+)?$/.test(name))).toBe(true);
}

/**
 * Opens Payments from the Admin navigation — a client-side navigation, so
 * the sign-in response (which streams the dashboard's Suspense sections)
 * finishes in the background instead of being aborted by a page.goto().
 */
async function openPaymentsFromAdminNav(page: Page) {
  await adminNav(page).getByRole("link", { name: "Payments", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/payments$/);
  await expect(page.getByRole("heading", { name: "Payments", level: 1 })).toBeVisible();
}

async function findEnrollment(page: Page, enrollmentCode: string) {
  await page.getByRole("link", { name: "Record offline payment" }).click();
  await expect(page).toHaveURL(/\/admin\/payments\/new$/);
  await expect(
    page.getByRole("heading", { name: "Record offline payment", level: 1 }),
  ).toBeVisible();
  const lookup = page.getByRole("form", { name: "Find enrollment" });
  await lookup.getByLabel("Enrollment code").fill(enrollmentCode);
  await lookup.getByRole("button", { name: "Find enrollment" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/payments/new\\?enrollment=${enrollmentCode}$`),
  );
}

/** The value shown for one term of a server-rendered <dl>. */
function definition(list: Locator, term: string): Locator {
  return list
    .locator("dt", { hasText: new RegExp(`^${term}$`) })
    .locator("xpath=following-sibling::dd[1]");
}

function enrollmentContext(page: Page): Locator {
  return page.locator('dl[aria-label="Enrollment being paid"]');
}

async function recordPayment(
  page: Page,
  input: {
    amount: string;
    method: string;
    type?: string;
    paidOn?: string;
    reference: string;
  },
) {
  const form = page.getByRole("form", { name: "Record offline payment" });
  await form.getByLabel("Amount received (₹)").fill(input.amount);
  await form.getByLabel("Payment method").selectOption({ label: input.method });
  if (input.type)
    await form.getByLabel("Payment type").selectOption({ label: input.type });
  if (input.paidOn) await form.getByLabel("Date received").fill(input.paidOn);
  await form.getByLabel("Reference (optional)").fill(input.reference);
  await form.getByRole("button", { name: "Record payment" }).click();
}

/** After a successful record: the payment page, its id and code. */
async function expectRecorded(
  page: Page,
  enrollmentCode: string,
): Promise<{ id: string; code: string }> {
  await expect(page).toHaveURL(/\/admin\/payments\/[0-9a-f-]{36}\?recorded=1$/);
  const id = new URL(page.url()).pathname.split("/").pop() as string;
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^PAY-\d{6,}$/);
  const code = (await heading.textContent()) as string;
  await expect(
    page.getByRole("status").filter({ hasText: "recorded against" }),
  ).toHaveText(`Payment ${code} recorded against ${enrollmentCode}.`);
  return { id, code };
}

async function tableBodyCells(table: Locator): Promise<string[][]> {
  const rows = table.locator("tbody tr");
  const count = await rows.count();
  const out: string[][] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(await rows.nth(i).locator("td").allTextContents());
  }
  return out;
}

async function filterLedger(
  page: Page,
  input: { search?: string; method?: string; from?: string; to?: string },
) {
  const form = page.getByRole("form", { name: "Payment filters" });
  if (input.search !== undefined) await form.getByLabel("Search").fill(input.search);
  if (input.method) await form.getByLabel("Method").selectOption({ label: input.method });
  if (input.from) await form.getByLabel("Payment date from").fill(input.from);
  if (input.to) await form.getByLabel("Payment date to").fill(input.to);
  await form.getByRole("button", { name: "Apply filters" }).click();
}

function istDate(offsetDays: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

async function createAdmin(tracked: Phase20Tracked, tag: string): Promise<Phase20Admin> {
  try {
    const admin = await createPhase20Admin(tag);
    tracked.admins.push(admin);
    return admin;
  } catch (err) {
    if (err instanceof Phase20PartialIdentityError) tracked.admins.push(err.partial);
    throw err;
  }
}

async function requireProgramWithBatch(): Promise<ExistingProgramWithBatch> {
  const found = await findExistingProgramWithBatch();
  if (!found) throw new Error("No existing Batch was found on the dev project.");
  return found;
}

async function cleanup(tracked: Phase20Tracked) {
  const failures = await cleanupPhase20(tracked);
  expect(
    failures,
    failures.length > 0
      ? "One or more synthetic Phase 20 records failed to clean up. Verify by exact id " +
          `only; never broaden deletion:\n${failures.join("\n")}`
      : undefined,
  ).toEqual([]);
}

// ---------------------------------------------------------------------------
// 1. Record -> ledger -> audit -> Financial report -> Enrollment page.

test.describe("Admin records an offline payment", () => {
  const tracked = newPhase20Tracked();
  const marker = phase20Marker("Record");
  let admin: Phase20Admin;
  let programBatch: ExistingProgramWithBatch;
  let student: Phase20Student;
  let enrollment: Phase20Enrollment;

  test.beforeAll(async () => {
    admin = await createAdmin(tracked, "RecordAdmin");
    programBatch = await requireProgramWithBatch();
    student = await createPhase20Student(tracked, { marker, lastName: "Learner" });
    enrollment = await createPhase20Enrollment(tracked, {
      studentId: student.id,
      programId: programBatch.programId,
      batchId: programBatch.batchId,
      totalPayable: "10000.00",
    });
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  test("payment lands in the ledger, is audited, and Phase 14/19 figures reconcile", async ({
    page,
  }) => {
    await login(page, admin);
    await openPaymentsFromAdminNav(page);
    await findEnrollment(page, enrollment.enrollmentCode);

    // The learner and enrollment are identified before anything is entered.
    const context = enrollmentContext(page);
    await expect(definition(context, "Student")).toHaveText(student.name);
    await expect(definition(context, "Student ID")).toHaveText(student.studentCode);
    await expect(definition(context, "Program")).toHaveText(
      `${programBatch.programName} (${programBatch.programCode})`,
    );
    await expect(definition(context, "Batch")).toHaveText(programBatch.batchName);
    await expect(definition(context, "Enrollment")).toHaveText(enrollment.enrollmentCode);
    await expect(definition(context, "Total payable")).toHaveText("₹10,000.00");
    await expect(definition(context, "Already paid")).toHaveText("₹0.00");
    await expect(definition(context, "Outstanding")).toHaveText("₹10,000.00");

    await recordPayment(page, {
      amount: "2500.00",
      method: "UPI",
      reference: `${marker}-UTR`,
    });
    const payment = await expectRecorded(page, enrollment.enrollmentCode);
    tracked.paymentIds.push(payment.id);

    const details = page.locator('dl[aria-label="Payment details"]');
    await expect(definition(details, "Amount")).toHaveText("₹2,500.00");
    await expect(definition(details, "Method")).toHaveText("UPI");
    await expect(definition(details, "Payment date")).toHaveText(istDate(0));
    await expect(definition(details, "Enrollment")).toHaveText(enrollment.enrollmentCode);

    // Exactly one payment row, and exactly one audit entry for it.
    expect(await countPaymentsForEnrollment(enrollment.id)).toBe(1);
    const audit = await readPaymentAuditEntries(payment.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "payment.recorded_offline",
      entityType: "payment",
      actorAuthUserId: admin.authUserId,
      actorRole: "admin",
    });
    expect(audit[0].after).toMatchObject({
      paymentCode: payment.code,
      enrollmentId: enrollment.id,
      amount: "2500.00",
      method: "upi",
    });

    // Ledger.
    await page.getByRole("link", { name: "← Payments" }).click();
    await expect(page).toHaveURL(/\/admin\/payments$/);
    await filterLedger(page, { search: enrollment.enrollmentCode });
    await expect(page.getByText("1 payment", { exact: true })).toBeVisible();
    const [row] = await tableBodyCells(page.getByRole("table", { name: "Payments" }));
    expect(row[0]).toBe(payment.code);
    expect(row[1]).toBe(istDate(0));
    expect(row[3]).toBe(enrollment.enrollmentCode);
    expect(row.slice(5, 7)).toEqual(["₹2,500.00", "UPI"]);
    expect(row[8]).toBe(`${marker}-UTR`);
    expect(row[9]).toBe("Paid");

    // Phase 19 Financial report: moved by exactly the payment.
    await page.goto(`/admin/reports/financial?q=${marker}`);
    await expect(
      page.getByRole("heading", { name: "Financial report", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Showing 1–1 of 1 row.")).toBeVisible();
    const [reportRow] = await tableBodyCells(
      page.getByRole("table", { name: "Financial report" }),
    );
    expect(reportRow[0]).toBe(enrollment.enrollmentCode);
    expect(reportRow.slice(7)).toEqual(["₹10,000.00", "₹2,500.00", "₹0.00", "₹7,500.00"]);

    // Phase 14 Enrollment Financial Position (whole-rupee display there).
    await page.goto(`/admin/enrollments/${enrollment.id}`);
    const card = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText("Financial Position", { exact: true }) });
    const figure = (label: string) =>
      card.getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]");
    await expect(figure("Total payable")).toHaveText("₹10,000");
    await expect(figure("Total paid")).toHaveText("₹2,500");
    await expect(figure("Total refunded")).toHaveText("₹0");
    await expect(figure("Outstanding")).toHaveText("₹7,500");
  });
});

// ---------------------------------------------------------------------------
// 2. Back-dated paise payment, overpayment refused, found again after a
//    fresh sign-in through the ledger filters.

test.describe("Admin finds a recorded payment again", () => {
  const tracked = newPhase20Tracked();
  const marker = phase20Marker("Find");
  let admin: Phase20Admin;
  let enrollment: Phase20Enrollment;

  test.beforeAll(async () => {
    admin = await createAdmin(tracked, "FindAdmin");
    const programBatch = await requireProgramWithBatch();
    const student = await createPhase20Student(tracked, { marker, lastName: "Payer" });
    enrollment = await createPhase20Enrollment(tracked, {
      studentId: student.id,
      programId: programBatch.programId,
      batchId: programBatch.batchId,
      totalPayable: "5000.00",
    });
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  test("ledger filters find it after a fresh sign-in; overpayment is refused", async ({
    page,
  }) => {
    const yesterday = istDate(-1);
    const reference = `${marker}-CASH`;

    await login(page, admin);
    await openPaymentsFromAdminNav(page);
    await findEnrollment(page, enrollment.enrollmentCode);
    await recordPayment(page, {
      amount: "1200.75",
      method: "Cash",
      type: "Registration fee",
      paidOn: yesterday,
      reference,
    });
    const payment = await expectRecorded(page, enrollment.enrollmentCode);
    tracked.paymentIds.push(payment.id);

    // One paisa over the remaining balance is refused by the database.
    await page.getByRole("link", { name: "← Payments" }).click();
    await expect(page).toHaveURL(/\/admin\/payments$/);
    await findEnrollment(page, enrollment.enrollmentCode);
    await expect(definition(enrollmentContext(page), "Outstanding")).toHaveText(
      "₹3,799.25",
    );
    await recordPayment(page, { amount: "3799.26", method: "Cash", reference });
    await expect(
      page.getByRole("form", { name: "Record offline payment" }).getByRole("alert"),
    ).toHaveText("Amount exceeds the outstanding balance of 3799.25.");
    await expect(page).toHaveURL(/\/admin\/payments\/new\?enrollment=/);
    expect(await countPaymentsForEnrollment(enrollment.id)).toBe(1);

    // Fresh sign-in: the payment persists and the filters find exactly it.
    await page.context().clearCookies();
    await login(page, admin);
    await openPaymentsFromAdminNav(page);
    await filterLedger(page, {
      search: reference,
      method: "Cash",
      from: yesterday,
      to: yesterday,
    });
    await expect(page.getByText("1 payment", { exact: true })).toBeVisible();
    const table = page.getByRole("table", { name: "Payments" });
    const [row] = await tableBodyCells(table);
    expect(row[0]).toBe(payment.code);
    expect(row[1]).toBe(yesterday);
    expect(row.slice(5, 8)).toEqual(["₹1,200.75", "Cash", "Registration fee"]);

    // A different date range excludes it.
    await filterLedger(page, { from: istDate(0), to: istDate(0) });
    await expect(page.getByText("0 payments", { exact: true })).toBeVisible();

    // Its read-only page.
    await filterLedger(page, { from: yesterday, to: yesterday });
    await table.getByRole("link", { name: payment.code }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/payments/${payment.id}$`));
    await expect(
      page.getByRole("heading", { name: payment.code, level: 1 }),
    ).toBeVisible();
    const details = page.locator('dl[aria-label="Payment details"]');
    await expect(definition(details, "Amount")).toHaveText("₹1,200.75");
    await expect(definition(details, "Type")).toHaveText("Registration fee");
    await expect(definition(details, "Reference")).toHaveText(reference);
    await expect(definition(details, "Recorded by")).toHaveText(
      `${admin.firstName} ${admin.lastName}`,
    );
    await expect(page.getByRole("button", { name: /edit|delete/i })).toHaveCount(0);
  });
});
