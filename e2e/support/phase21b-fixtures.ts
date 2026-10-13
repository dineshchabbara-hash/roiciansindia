import { createHmac, randomBytes, randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { deleteReceiptOfPayment } from "./receipt-cleanup";

/**
 * Node-side setup/teardown for the Phase 21B (Refunds) E2E suite
 * (e2e/phase21b-refunds.spec.ts). Self-contained, like every prior phase's
 * fixtures, so its markers can be audited on their own.
 *
 * The service-role client creates and removes ONLY this suite's synthetic
 * rows and READS what the app produced. Refunds are made by the running
 * app (offline form, Razorpay form) or decided by Razorpay's own signed
 * webhook; the one fixture-made refund row is an `initiated` reservation
 * standing in for a refund Razorpay has accepted (a real TEST-mode refund
 * needs a real captured TEST payment, which only a manual hosted-Checkout
 * run can create — see IMPLEMENTATION_PLAN.md Phase 21B).
 *
 * Markers: auth emails on @phase21b-e2e.internal.test; names start with
 * "Phase21BE2E" + RUN_ID; synthetic Razorpay ids are
 * order_P21BE2E<RUN_ID>… / pay_P21BE2E<RUN_ID>… / rfnd_P21BE2E<RUN_ID>….
 *
 * Cleanup is exact-id and children-first: for each tracked enrollment, its
 * payments by exact FK; per payment: webhook-log rows by the payment's own
 * exact provider payment id, refunds by exact payment id, the receipt (row
 * + exact PDF path), the payment; then enrollments -> students -> admins
 * -> auth users. Never by amount, date, status, method or id prefix.
 * audit_logs are never touched.
 *
 * This is intentionally NOT a .spec.ts file.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export { hasRealSupabaseCredentials } from "./phase5-fixtures";

export const PHASE21B_E2E_EMAIL_DOMAIN = "phase21b-e2e.internal.test";
export const PHASE21B_E2E_PREFIX = "Phase21BE2E";
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** TEST-mode keys (for the Admin's Razorpay refund call) and the webhook secret. */
export function hasRazorpayTestConfig(): boolean {
  return (
    /^rzp_test_[A-Za-z0-9]+$/.test(process.env.RAZORPAY_KEY_ID ?? "") &&
    Boolean(process.env.RAZORPAY_KEY_SECRET) &&
    Boolean(process.env.RAZORPAY_WEBHOOK_SECRET)
  );
}

export function phase21bMarker(block: string): string {
  return `${PHASE21B_E2E_PREFIX}${RUN_ID}${block}`;
}

export function syntheticId(prefix: "order" | "pay" | "rfnd", block: string): string {
  return `${prefix}_P21BE2E${RUN_ID}${block}`.replace(/[^A-Za-z0-9_]/g, "");
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

// Distinct phone block from every earlier phase's (9908-...).
function syntheticPhone(): string {
  return `9908${randomInt(10, 100)}${randomInt(1000, 10000)}`.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tracked ids

export type Phase21BAdmin = {
  authUserId: string;
  email: string;
  password: string;
  profileId: string | null;
};

export type Phase21BTracked = {
  admins: Phase21BAdmin[];
  studentIds: string[];
  enrollmentIds: string[];
};

export function newPhase21BTracked(): Phase21BTracked {
  return { admins: [], studentIds: [], enrollmentIds: [] };
}

export async function createPhase21BAdmin(
  tracked: Phase21BTracked,
  tag: string,
): Promise<Phase21BAdmin> {
  const supabase = serviceClient();
  const email = `phase21b-e2e-admin-${tag.toLowerCase()}-${RUN_ID}@${PHASE21B_E2E_EMAIL_DOMAIN}`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) throw new Error(`Failed to create admin: ${error?.message}`);
  const admin: Phase21BAdmin = {
    authUserId: data.user.id,
    email,
    password,
    profileId: null,
  };
  tracked.admins.push(admin);

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: admin.authUserId, role: "admin" }),
  );
  if (roleError) throw new Error(`Failed to assign admin role: ${roleError.message}`);
  const { data: row, error: profileError } = await safely<{ id: string }>(() =>
    supabase
      .from("admins")
      .insert({
        auth_user_id: admin.authUserId,
        first_name: phase21bMarker(tag),
        last_name: "Admin",
        email,
        role_level: "admin",
      })
      .select("id")
      .single(),
  );
  if (profileError || !row)
    throw new Error(`Failed to create admins row: ${profileError?.message}`);
  admin.profileId = row.id;
  return admin;
}

export async function createPhase21BStudent(
  tracked: Phase21BTracked,
  marker: string,
): Promise<{ id: string; studentCode: string }> {
  const email = `phase21b-e2e-student-${tracked.studentIds.length}-${RUN_ID}@${PHASE21B_E2E_EMAIL_DOMAIN}`;
  const { data, error } = await serviceClient()
    .from("students")
    .insert({
      first_name: marker,
      last_name: "Payer",
      email,
      phone: syntheticPhone(),
      status: "active",
    })
    .select("id, student_code")
    .single();
  if (error || !data) throw new Error(`Failed to create student: ${error?.message}`);
  tracked.studentIds.push(data.id);
  return { id: data.id, studentCode: data.student_code };
}

export async function findExistingProgramWithBatch(): Promise<{
  programId: string;
  batchId: string;
} | null> {
  const { data, error } = await serviceClient()
    .from("batches")
    .select("id, program_id")
    .order("id", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Could not look up an existing batch: ${error.message}`);
  const row = (data ?? [])[0] as { id: string; program_id: string } | undefined;
  return row ? { programId: row.program_id, batchId: row.id } : null;
}

export async function createPhase21BEnrollment(
  tracked: Phase21BTracked,
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

/**
 * An already-paid payment for the enrollment (a refund needs one). Offline
 * rows carry the recording admin; Razorpay rows carry synthetic provider
 * ids that exist only in this database.
 */
export async function insertPaidPayment(input: {
  enrollmentId: string;
  studentId: string;
  amount: string;
  method: "cash" | "razorpay";
  adminProfileId?: string;
  providerBlock?: string;
}): Promise<{ id: string; paymentCode: string; providerPaymentId: string | null }> {
  const providerPaymentId =
    input.method === "razorpay" ? syntheticId("pay", input.providerBlock ?? "A") : null;
  const { data, error } = await serviceClient()
    .from("payments")
    .insert({
      student_id: input.studentId,
      enrollment_id: input.enrollmentId,
      payment_type: "full",
      amount: input.amount,
      tax_amount: 0,
      total_amount: input.amount,
      method: input.method,
      status: "paid",
      internal_reference: input.method === "cash" ? phase21bMarker("CASH") : null,
      created_by: input.method === "cash" ? (input.adminProfileId ?? null) : null,
      razorpay_order_id:
        input.method === "razorpay"
          ? syntheticId("order", input.providerBlock ?? "A")
          : null,
      razorpay_payment_id: providerPaymentId,
      paid_at: new Date(Date.now() - 86_400_000).toISOString(),
    })
    .select("id, payment_code")
    .single();
  if (error || !data) throw new Error(`Failed to insert payment: ${error?.message}`);
  return { id: data.id, paymentCode: data.payment_code, providerPaymentId };
}

/** An initiated refund standing in for one Razorpay has accepted. */
export async function insertAcceptedRazorpayRefund(input: {
  paymentId: string;
  amount: string;
  providerRefundId: string;
  adminProfileId: string;
}): Promise<string> {
  const { data, error } = await serviceClient()
    .from("payment_refunds")
    .insert({
      payment_id: input.paymentId,
      amount: input.amount,
      reason: phase21bMarker("Accepted"),
      status: "initiated",
      razorpay_refund_id: input.providerRefundId,
      initiated_by: input.adminProfileId,
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(`Failed to insert refund reservation: ${error?.message}`);
  return data.id;
}

/** A refund event signed exactly as Razorpay signs webhooks (HMAC of the raw body). */
export function signedRefundWebhook(input: {
  event: "refund.processed" | "refund.failed";
  providerRefundId: string;
  providerPaymentId: string;
  amountPaise: number;
  refundId: string;
}): { body: string; signature: string } {
  const body = JSON.stringify({
    entity: "event",
    account_id: "acc_test",
    event: input.event,
    contains: ["refund", "payment"],
    payload: {
      refund: {
        entity: {
          id: input.providerRefundId,
          entity: "refund",
          amount: input.amountPaise,
          currency: "INR",
          payment_id: input.providerPaymentId,
          notes: { roicians_refund_id: input.refundId },
          status: input.event === "refund.processed" ? "processed" : "failed",
          speed_processed: "normal",
          created_at: Math.floor(Date.now() / 1000),
        },
      },
      payment: { entity: { id: input.providerPaymentId, entity: "payment" } },
    },
    created_at: Math.floor(Date.now() / 1000),
  });
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  return { body, signature: createHmac("sha256", secret).update(body).digest("hex") };
}

// ---------------------------------------------------------------------------
// Read-only verification

export async function readRefunds(paymentId: string) {
  const { data, error } = await serviceClient()
    .from("payment_refunds")
    .select("id, amount, status, reason, reference, refunded_on, razorpay_refund_id")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read refunds: ${error.message}`);
  return data ?? [];
}

export async function readPaymentRow(paymentId: string) {
  const { data, error } = await serviceClient()
    .from("payments")
    .select("status, amount, total_amount, paid_at, updated_at")
    .eq("id", paymentId)
    .single();
  if (error) throw new Error(`Could not read payment: ${error.message}`);
  return data;
}

export async function readEnrollmentTerms(enrollmentId: string) {
  const { data, error } = await serviceClient()
    .from("enrollments")
    .select(
      "total_payable, agreed_fee, discount_amount, registration_fee, tax_amount, updated_at",
    )
    .eq("id", enrollmentId)
    .single();
  if (error) throw new Error(`Could not read enrollment: ${error.message}`);
  return data;
}

export async function readRefundAudit(refundId: string) {
  const { data, error } = await serviceClient()
    .from("audit_logs")
    .select("action, actor_role")
    .eq("entity_id", refundId);
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

export async function cleanupPhase21B(tracked: Phase21BTracked): Promise<string[]> {
  const supabase = serviceClient();
  const failures: string[] = [];
  const push = (f: string | null) => f && failures.push(f);

  for (const enrollmentId of tracked.enrollmentIds) {
    const { data: payments, error } = await safely<
      Array<{ id: string; razorpay_payment_id: string | null }>
    >(() =>
      supabase
        .from("payments")
        .select("id, razorpay_payment_id")
        .eq("enrollment_id", enrollmentId),
    );
    if (error) failures.push(`payments for ${enrollmentId}: ${error.message}`);
    for (const payment of payments ?? []) {
      if (payment.razorpay_payment_id) {
        push(
          await deleteWhere(
            "razorpay_webhook_events",
            "provider_payment_id",
            payment.razorpay_payment_id,
          ),
        );
      }
      push(await deleteWhere("payment_refunds", "payment_id", payment.id));
      push(await deleteReceiptOfPayment(supabase, payment.id));
      push(await deleteWhere("payments", "id", payment.id));
    }
  }
  for (const id of tracked.enrollmentIds)
    push(await deleteWhere("enrollments", "id", id));
  for (const id of tracked.studentIds) push(await deleteWhere("students", "id", id));
  for (const admin of tracked.admins) {
    if (admin.profileId) push(await deleteWhere("admins", "id", admin.profileId));
    const { error } = await safely<unknown>(() =>
      supabase.auth.admin.deleteUser(admin.authUserId),
    );
    if (error) failures.push(`auth user ${admin.email}: ${error.message}`);
  }
  return failures;
}
