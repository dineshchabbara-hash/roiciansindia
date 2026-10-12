import { createHmac, randomBytes, randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { deleteReceiptOfPayment, readReceiptOfPayment } from "./receipt-cleanup";

/**
 * Node-side setup/teardown for the Phase 20B (Razorpay test mode) E2E
 * suite (e2e/phase20b-razorpay.spec.ts). Self-contained, like every prior
 * phase's fixtures, so its markers can be audited on their own.
 *
 * The service-role client creates and removes ONLY this suite's synthetic
 * rows and READS the ledger/audit/order rows the app produced. It never
 * records a payment: orders are created by the running app (which calls
 * Razorpay's TEST API), and the only success signal is a webhook signed
 * with RAZORPAY_WEBHOOK_SECRET exactly as Razorpay signs it — the app's
 * own verification decides.
 *
 * Markers: auth emails on @phase20b-e2e.internal.test; names start with
 * "Phase20BE2E" + RUN_ID; synthetic Razorpay payment ids start with
 * `pay_P20BE2E<RUN_ID>`. Razorpay TEST orders created through the app stay
 * in the Razorpay Dashboard (Razorpay cannot delete orders) and are TEST
 * entities only — no money moves.
 *
 * Cleanup is exact-id and children-first: payment_orders and payments are
 * selected strictly by this run's tracked enrollment ids (exact foreign
 * key), webhook-log rows strictly by this run's exact provider order ids,
 * each payment's receipt (row + exact PDF object, Phase 21A) by that exact
 * payment id, then installments -> payment_plans -> enrollments -> students ->
 * profile/auth user. Never by amount, date, method, status or id prefix;
 * audit_logs are never touched.
 *
 * This is intentionally NOT a .spec.ts file.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export { hasRealSupabaseCredentials } from "./phase5-fixtures";

export const PHASE20B_E2E_EMAIL_DOMAIN = "phase20b-e2e.internal.test";
export const PHASE20B_E2E_PREFIX = "Phase20BE2E";
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** True only when TEST-mode Razorpay keys and a webhook secret are configured. */
export function hasRazorpayTestConfig(): boolean {
  return (
    /^rzp_test_[A-Za-z0-9]+$/.test(process.env.RAZORPAY_KEY_ID ?? "") &&
    Boolean(process.env.RAZORPAY_KEY_SECRET) &&
    Boolean(process.env.RAZORPAY_WEBHOOK_SECRET)
  );
}

export function phase20bMarker(block: string): string {
  return `${PHASE20B_E2E_PREFIX}${RUN_ID}${block}`;
}

export function syntheticPaymentId(block: string): string {
  return `pay_P20BE2E${RUN_ID}${block}`.replace(/[^A-Za-z0-9_]/g, "");
}

function serviceClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing real Supabase credentials — call hasRealSupabaseCredentials() first.",
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function safely<T = unknown>(
  operation: () => PromiseLike<{ data?: T | null; error: { message: string } | null }>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    const result = await operation();
    return { data: result.data ?? null, error: result.error };
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  }
}

// Distinct phone block from every earlier phase's (9906-...).
function syntheticPhone(): string {
  return `9906${randomInt(10, 100)}${randomInt(1000, 10000)}`.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tracked ids

export type Phase20BStudent = {
  authUserId: string;
  email: string;
  password: string;
  studentId: string | null;
};

export type Phase20BTracked = {
  students: Phase20BStudent[];
  enrollmentIds: string[];
  planIds: string[];
  installmentIds: string[];
};

export function newPhase20BTracked(): Phase20BTracked {
  return { students: [], enrollmentIds: [], planIds: [], installmentIds: [] };
}

// ---------------------------------------------------------------------------
// Student login identity: auth user + user_roles + students row

export async function createPhase20BStudent(
  tracked: Phase20BTracked,
  tag: string,
): Promise<Phase20BStudent> {
  const supabase = serviceClient();
  const email = `phase20b-e2e-student-${tag.toLowerCase()}-${RUN_ID}@${PHASE20B_E2E_EMAIL_DOMAIN}`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user)
    throw new Error(`Failed to create student (${tag}): ${error?.message}`);
  const student: Phase20BStudent = {
    authUserId: data.user.id,
    email,
    password,
    studentId: null,
  };
  tracked.students.push(student);

  const { error: roleError } = await safely(() =>
    supabase
      .from("user_roles")
      .insert({ auth_user_id: student.authUserId, role: "student" }),
  );
  if (roleError) throw new Error(`Failed to assign student role: ${roleError.message}`);

  const { data: row, error: profileError } = await safely<{ id: string }>(() =>
    supabase
      .from("students")
      .insert({
        auth_user_id: student.authUserId,
        first_name: `${PHASE20B_E2E_PREFIX}${RUN_ID}${tag}`,
        last_name: "Student",
        email,
        phone: syntheticPhone(),
        status: "active",
      })
      .select("id")
      .single(),
  );
  if (profileError || !row)
    throw new Error(`Failed to create students row: ${profileError?.message}`);
  student.studentId = row.id;
  return student;
}

// ---------------------------------------------------------------------------
// Enrollment (+ optional plan) on an existing Program/Batch (read-only lookup)

export async function findExistingProgramWithBatch(): Promise<{
  programId: string;
  batchId: string;
} | null> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("batches")
    .select("id, program_id")
    .order("id", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Could not look up an existing batch: ${error.message}`);
  const row = (data ?? [])[0] as { id: string; program_id: string } | undefined;
  return row ? { programId: row.program_id, batchId: row.id } : null;
}

export async function createPhase20BEnrollment(
  tracked: Phase20BTracked,
  input: {
    studentId: string;
    programId: string;
    batchId: string;
    totalPayable: string;
    installments?: string[];
  },
): Promise<{ id: string; enrollmentCode: string }> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("enrollments")
    .insert({
      student_id: input.studentId,
      program_id: input.programId,
      batch_id: input.batchId,
      regular_fee: input.totalPayable,
      agreed_fee: input.totalPayable,
      total_payable: input.totalPayable,
      status: "active",
    })
    .select("id, enrollment_code")
    .single();
  if (error || !data) throw new Error(`Failed to create enrollment: ${error?.message}`);
  tracked.enrollmentIds.push(data.id);

  if (input.installments?.length) {
    const total = input.installments.reduce((sum, a) => sum + Number(a), 0).toFixed(2);
    const { data: planRow, error: planError } = await supabase
      .from("payment_plans")
      .insert({ enrollment_id: data.id, total_amount: total })
      .select("id")
      .single();
    if (planError || !planRow)
      throw new Error(`Failed to create plan: ${planError?.message}`);
    tracked.planIds.push(planRow.id);
    for (const [index, amount] of input.installments.entries()) {
      const { data: inst, error: instError } = await supabase
        .from("installments")
        .insert({
          payment_plan_id: planRow.id,
          sequence: index + 1,
          amount,
          due_date: new Date(Date.now() + index * 30 * 86400000)
            .toISOString()
            .slice(0, 10),
        })
        .select("id")
        .single();
      if (instError || !inst)
        throw new Error(`Failed to create installment: ${instError?.message}`);
      tracked.installmentIds.push(inst.id);
    }
  }
  return { id: data.id, enrollmentCode: data.enrollment_code };
}

// ---------------------------------------------------------------------------
// Signed webhook (exactly Razorpay's scheme: HMAC-SHA256 of the raw body)

export function signedCapturedWebhook(input: {
  orderId: string;
  paymentId: string;
  amountPaise: number;
}): { body: string; signature: string } {
  const body = JSON.stringify({
    entity: "event",
    account_id: "acc_test",
    event: "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: input.paymentId,
          entity: "payment",
          amount: input.amountPaise,
          currency: "INR",
          status: "captured",
          order_id: input.orderId,
          method: "upi",
          captured: true,
          created_at: Math.floor(Date.now() / 1000),
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  });
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  return { body, signature: createHmac("sha256", secret).update(body).digest("hex") };
}

// ---------------------------------------------------------------------------
// Read-only verification

export async function readEnrollmentPayments(enrollmentId: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, method, status, total_amount, razorpay_order_id, razorpay_payment_id, created_by",
    )
    .eq("enrollment_id", enrollmentId);
  if (error) throw new Error(`Could not read payments: ${error.message}`);
  return data ?? [];
}

export async function readEnrollmentOrders(enrollmentId: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("payment_orders")
    .select("provider_order_id, purpose, amount, status, payment_id")
    .eq("enrollment_id", enrollmentId);
  if (error) throw new Error(`Could not read orders: ${error.message}`);
  return data ?? [];
}

export async function readPaymentAudit(paymentId: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("action, actor_role, after_data")
    .eq("entity_id", paymentId);
  if (error) throw new Error(`Could not read audit_logs: ${error.message}`);
  return data ?? [];
}

/** Phase 21A: the receipt of one exact payment id (read only), or null. */
export async function readPaymentReceipt(paymentId: string) {
  return readReceiptOfPayment(serviceClient(), paymentId);
}

export async function readWebhookEvents(orderId: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("razorpay_webhook_events")
    .select("event_id, outcome, processed_at")
    .eq("provider_order_id", orderId);
  if (error) throw new Error(`Could not read webhook events: ${error.message}`);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Exact-id cleanup

async function deleteWhere(
  table: string,
  column: string,
  value: string,
): Promise<string | null> {
  const supabase = serviceClient();
  const { error } = await safely(() => supabase.from(table).delete().eq(column, value));
  return error ? `${table} ${column}=${value}: ${error.message}` : null;
}

export async function cleanupPhase20B(tracked: Phase20BTracked): Promise<string[]> {
  const supabase = serviceClient();
  const failures: string[] = [];
  const push = (f: string | null) => f && failures.push(f);

  for (const enrollmentId of tracked.enrollmentIds) {
    // Orders reference payments (payment_id), so orders go first.
    const { data: orders, error: ordersError } = await safely<
      Array<{ id: string; provider_order_id: string }>
    >(() =>
      supabase
        .from("payment_orders")
        .select("id, provider_order_id")
        .eq("enrollment_id", enrollmentId),
    );
    if (ordersError)
      failures.push(`payment_orders for ${enrollmentId}: ${ordersError.message}`);
    for (const order of orders ?? []) {
      push(
        await deleteWhere(
          "razorpay_webhook_events",
          "provider_order_id",
          order.provider_order_id,
        ),
      );
      push(await deleteWhere("payment_orders", "id", order.id));
    }
    const { data: payments, error: paymentsError } = await safely<Array<{ id: string }>>(
      () => supabase.from("payments").select("id").eq("enrollment_id", enrollmentId),
    );
    if (paymentsError)
      failures.push(`payments for ${enrollmentId}: ${paymentsError.message}`);
    for (const payment of payments ?? []) {
      // Phase 21A: the paid payment's receipt (row + exact PDF) goes first.
      push(await deleteReceiptOfPayment(supabase, payment.id));
      push(await deleteWhere("payments", "id", payment.id));
    }
  }
  for (const id of tracked.installmentIds)
    push(await deleteWhere("installments", "id", id));
  for (const id of tracked.planIds) push(await deleteWhere("payment_plans", "id", id));
  for (const id of tracked.enrollmentIds)
    push(await deleteWhere("enrollments", "id", id));
  for (const student of tracked.students) {
    if (student.studentId) push(await deleteWhere("students", "id", student.studentId));
    const { error } = await safely<unknown>(() =>
      supabase.auth.admin.deleteUser(student.authUserId),
    );
    if (error) failures.push(`auth user ${student.email}: ${error.message}`);
  }
  return failures;
}
