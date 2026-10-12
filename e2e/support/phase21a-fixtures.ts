import { createHmac, randomBytes, randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  deleteReceiptOfPayment,
  readReceiptOfPayment,
  type ReceiptRow,
} from "./receipt-cleanup";

/**
 * Node-side setup/teardown for the Phase 21A (Receipts) E2E suite
 * (e2e/phase21a-receipts.spec.ts). Self-contained, like every prior
 * phase's fixtures, so its markers can be audited on their own.
 *
 * The service-role client creates and removes ONLY this suite's synthetic
 * rows and READS what the app produced. It never issues a receipt and
 * never records a paid payment through a back door used by the app:
 *  - offline: the synthetic Admin records the payment through the real UI;
 *  - online: a synthetic Razorpay order is registered with the same
 *    service-role database function the app uses (no Razorpay API call, so
 *    nothing is left in the Razorpay Dashboard), and the payment becomes
 *    paid only through the app's real webhook route, signed with
 *    RAZORPAY_WEBHOOK_SECRET exactly as Razorpay signs it.
 * The one exception is the OTHER Student's payment used for the
 * cross-access check: it is inserted directly as paid (its own receipt is
 * then issued by the real database function), because the test only needs
 * a receipt that belongs to someone else.
 *
 * Markers: auth emails on @phase21a-e2e.internal.test; names start with
 * "Phase21AE2E" + RUN_ID; synthetic Razorpay ids are order_P21AE2E<RUN_ID>…
 * / pay_P21AE2E<RUN_ID>….
 *
 * Cleanup is exact-id and children-first: for each tracked enrollment,
 * webhook-log rows by this run's exact provider order ids, payment_orders
 * by exact id, each payment's receipt (row + exact PDF object path), the
 * payment by exact id; then enrollments -> students -> admins -> auth
 * users. Never by receipt number, date, amount, method, status, file
 * extension or prefix. audit_logs are never touched.
 *
 * This is intentionally NOT a .spec.ts file.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export { hasRealSupabaseCredentials } from "./phase5-fixtures";

export const PHASE21A_E2E_EMAIL_DOMAIN = "phase21a-e2e.internal.test";
export const PHASE21A_E2E_PREFIX = "Phase21AE2E";
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The webhook test only needs the webhook secret (no Razorpay API call is made). */
export function hasRazorpayWebhookSecret(): boolean {
  return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
}

export function phase21aMarker(block: string): string {
  return `${PHASE21A_E2E_PREFIX}${RUN_ID}${block}`;
}

export function syntheticOrderId(block: string): string {
  return `order_P21AE2E${RUN_ID}${block}`.replace(/[^A-Za-z0-9_]/g, "");
}

export function syntheticPaymentId(block: string): string {
  return `pay_P21AE2E${RUN_ID}${block}`.replace(/[^A-Za-z0-9_]/g, "");
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

// Distinct phone block from every earlier phase's (9907-...).
function syntheticPhone(): string {
  return `9907${randomInt(10, 100)}${randomInt(1000, 10000)}`.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tracked ids

export type Phase21AIdentity = {
  role: "admin" | "student";
  authUserId: string;
  email: string;
  password: string;
  /** admins.id or students.id once created. */
  profileId: string | null;
};

export type Phase21ATracked = {
  identities: Phase21AIdentity[];
  /** Students without a login (the offline test's payer). */
  studentIds: string[];
  enrollmentIds: string[];
};

export function newPhase21ATracked(): Phase21ATracked {
  return { identities: [], studentIds: [], enrollmentIds: [] };
}

// ---------------------------------------------------------------------------
// Identities

async function createAuthIdentity(
  tracked: Phase21ATracked,
  role: "admin" | "student",
  tag: string,
): Promise<Phase21AIdentity> {
  const supabase = serviceClient();
  const email = `phase21a-e2e-${role}-${tag.toLowerCase()}-${RUN_ID}@${PHASE21A_E2E_EMAIL_DOMAIN}`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user)
    throw new Error(`Failed to create ${role} identity (${tag}): ${error?.message}`);
  const identity: Phase21AIdentity = {
    role,
    authUserId: data.user.id,
    email,
    password,
    profileId: null,
  };
  tracked.identities.push(identity);

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: identity.authUserId, role }),
  );
  if (roleError) throw new Error(`Failed to assign ${role} role: ${roleError.message}`);
  return identity;
}

export async function createPhase21AAdmin(
  tracked: Phase21ATracked,
  tag: string,
): Promise<Phase21AIdentity> {
  const admin = await createAuthIdentity(tracked, "admin", tag);
  const { data, error } = await safely<{ id: string }>(() =>
    serviceClient()
      .from("admins")
      .insert({
        auth_user_id: admin.authUserId,
        first_name: phase21aMarker(tag),
        last_name: "Admin",
        email: admin.email,
        role_level: "admin",
      })
      .select("id")
      .single(),
  );
  if (error || !data) throw new Error(`Failed to create admins row: ${error?.message}`);
  admin.profileId = data.id;
  return admin;
}

export async function createPhase21AStudentLogin(
  tracked: Phase21ATracked,
  tag: string,
): Promise<Phase21AIdentity> {
  const student = await createAuthIdentity(tracked, "student", tag);
  const { data, error } = await safely<{ id: string }>(() =>
    serviceClient()
      .from("students")
      .insert({
        auth_user_id: student.authUserId,
        first_name: phase21aMarker(tag),
        last_name: "Student",
        email: student.email,
        phone: syntheticPhone(),
        status: "active",
      })
      .select("id")
      .single(),
  );
  if (error || !data) throw new Error(`Failed to create students row: ${error?.message}`);
  student.profileId = data.id;
  return student;
}

export type Phase21AStudent = { id: string; studentCode: string; name: string };

/** A student without a login (pays at the front desk). */
export async function createPhase21AStudent(
  tracked: Phase21ATracked,
  tag: string,
): Promise<Phase21AStudent> {
  const email = `phase21a-e2e-student-${tag.toLowerCase()}-${RUN_ID}@${PHASE21A_E2E_EMAIL_DOMAIN}`;
  const { data, error } = await serviceClient()
    .from("students")
    .insert({
      first_name: phase21aMarker(tag),
      last_name: "Payer",
      email,
      phone: syntheticPhone(),
      status: "active",
    })
    .select("id, student_code, first_name, last_name")
    .single();
  if (error || !data) throw new Error(`Failed to create student: ${error?.message}`);
  tracked.studentIds.push(data.id);
  return {
    id: data.id,
    studentCode: data.student_code,
    name: `${data.first_name} ${data.last_name}`,
  };
}

// ---------------------------------------------------------------------------
// Enrollment on an existing Program/Batch (read-only lookup)

export async function findExistingProgramWithBatch(): Promise<{
  programId: string;
  batchId: string;
  programName: string;
  batchName: string;
} | null> {
  const { data, error } = await serviceClient()
    .from("batches")
    .select("id, name, program_id, program:programs(name)")
    .order("id", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Could not look up an existing batch: ${error.message}`);
  const row = (data ?? [])[0] as unknown as
    | { id: string; name: string; program_id: string; program: { name: string } | null }
    | undefined;
  return row
    ? {
        programId: row.program_id,
        batchId: row.id,
        programName: row.program?.name ?? "",
        batchName: row.name,
      }
    : null;
}

export async function createPhase21AEnrollment(
  tracked: Phase21ATracked,
  input: { studentId: string; programId: string; batchId: string; totalPayable: string },
): Promise<{ id: string; enrollmentCode: string }> {
  const { data, error } = await serviceClient()
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
  return { id: data.id, enrollmentCode: data.enrollment_code };
}

// ---------------------------------------------------------------------------
// Razorpay (synthetic order + signed webhook — no Razorpay API call)

/** Registers a synthetic order exactly as the app's server would after creating one. */
export async function registerSyntheticOrder(input: {
  orderId: string;
  enrollmentId: string;
  studentId: string;
  studentAuthUserId: string;
  amount: string;
}): Promise<void> {
  const { error } = await serviceClient().rpc("register_razorpay_order", {
    p_provider_order_id: input.orderId,
    p_enrollment_id: input.enrollmentId,
    p_student_id: input.studentId,
    p_purpose: "full_outstanding",
    p_installment_id: null,
    p_amount: input.amount,
    p_created_by_auth_user_id: input.studentAuthUserId,
    p_ttl_minutes: 30,
  });
  if (error) throw new Error(`Could not register the synthetic order: ${error.message}`);
}

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
// Another Student's paid payment (cross-access check only)

export async function insertForeignPaidPayment(input: {
  enrollmentId: string;
  studentId: string;
  amount: string;
}): Promise<{ paymentId: string; receipt: ReceiptRow }> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("payments")
    .insert({
      student_id: input.studentId,
      enrollment_id: input.enrollmentId,
      payment_type: "partial",
      amount: input.amount,
      tax_amount: 0,
      total_amount: input.amount,
      method: "cash",
      status: "paid",
      internal_reference: phase21aMarker("Foreign"),
      paid_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to insert payment: ${error?.message}`);
  // Issued by the real database function; its PDF is deliberately left
  // ungenerated so the test can prove a foreign request never generates it.
  const { error: issueError } = await supabase.rpc("issue_receipt", {
    p_payment_id: data.id,
  });
  if (issueError) throw new Error(`Failed to issue receipt: ${issueError.message}`);
  const receipt = await readReceiptOfPayment(supabase, data.id);
  if (!receipt) throw new Error("The foreign receipt was not issued.");
  return { paymentId: data.id, receipt };
}

// ---------------------------------------------------------------------------
// Read-only verification

export async function readEnrollmentPayments(enrollmentId: string) {
  const { data, error } = await serviceClient()
    .from("payments")
    .select("id, payment_code, method, status, total_amount, razorpay_payment_id")
    .eq("enrollment_id", enrollmentId);
  if (error) throw new Error(`Could not read payments: ${error.message}`);
  return data ?? [];
}

export async function readPaymentReceipt(paymentId: string): Promise<ReceiptRow | null> {
  return readReceiptOfPayment(serviceClient(), paymentId);
}

export async function countReceiptsForPayment(paymentId: string): Promise<number> {
  const { count, error } = await serviceClient()
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .eq("payment_id", paymentId);
  if (error) throw new Error(`Could not count receipts: ${error.message}`);
  return count ?? 0;
}

export async function readReceiptAudit(receiptId: string) {
  const { data, error } = await serviceClient()
    .from("audit_logs")
    .select("action, actor_role, after_data")
    .eq("entity_id", receiptId);
  if (error) throw new Error(`Could not read audit_logs: ${error.message}`);
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

export async function cleanupPhase21A(tracked: Phase21ATracked): Promise<string[]> {
  const supabase = serviceClient();
  const failures: string[] = [];
  const push = (f: string | null) => f && failures.push(f);

  for (const enrollmentId of tracked.enrollmentIds) {
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
      push(await deleteReceiptOfPayment(supabase, payment.id));
      push(await deleteWhere("payments", "id", payment.id));
    }
  }
  for (const id of tracked.enrollmentIds)
    push(await deleteWhere("enrollments", "id", id));
  for (const id of tracked.studentIds) push(await deleteWhere("students", "id", id));
  for (const identity of tracked.identities) {
    if (identity.profileId) {
      push(
        await deleteWhere(
          identity.role === "admin" ? "admins" : "students",
          "id",
          identity.profileId,
        ),
      );
    }
    const { error } = await safely<unknown>(() =>
      supabase.auth.admin.deleteUser(identity.authUserId),
    );
    if (error) failures.push(`auth user ${identity.email}: ${error.message}`);
  }
  return failures;
}
