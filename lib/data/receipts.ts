import "server-only";

import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DataResult } from "@/lib/data/dashboard";
import { toPaise } from "@/lib/domain/money";
import {
  buildReceiptDocument,
  isReceiptEligible,
  receiptFileName,
  type ReceiptSourceRow,
} from "@/lib/domain/receipts";

/**
 * Phase 21A (Receipts & Payment Documents) data layer — FR-94 / FR-95.
 *
 * One receipt system for every payment source. A receipt is issued from
 * the canonical `payments` row only, by the issue_receipt() database
 * function (20260101000037): it locks the payment, requires status `paid`,
 * returns the existing receipt if there is one, otherwise mints the number
 * from the global receipt_number_seq, inserts the row with a server-built
 * pdf_path and writes the single `receipt.issued` audit row — all in one
 * transaction. It is service_role only, so issuance always runs here, on
 * the server, after the caller has been authorized:
 *
 *  - offline: lib/actions/payments.ts, right after record_offline_payment;
 *  - Razorpay: lib/data/online-payments.ts, after finalize_razorpay_payment
 *    reports the payment recorded (webhook or verified Checkout), queued to
 *    run after the response so the webhook stays fast;
 *  - recovery: an Admin "Generate receipt" action, and the download route
 *    itself, which issues/generates on demand for any authorized viewer of
 *    a paid payment. A failed render or upload never loses or re-mints the
 *    number: the row stays with pdf_generated_at null and the same path is
 *    retried.
 *
 * The PDF is rendered from trusted database rows (never request input),
 * uploaded to the private `receipts` bucket and marked generated once.
 * Downloads read the receipt and its object through the VIEWER'S own
 * RLS-scoped session (receipts_select_* / receipts_bucket_select_*), so an
 * Admin reads any receipt and a Student only their own; the stored path is
 * never sent to the browser.
 */

export const RECEIPTS_BUCKET = "receipts";

// lib/pdf/receipt.tsx is loaded lazily for the same reason as
// lib/data/certificates.ts: @react-pdf/renderer instantiates WASM when its
// module is evaluated, which must not happen for read-only callers.
type ReceiptPdfModule = typeof import("@/lib/pdf/receipt");
let receiptPdfModulePromise: Promise<ReceiptPdfModule> | null = null;
function loadRenderReceiptPdf() {
  receiptPdfModulePromise ??= import("@/lib/pdf/receipt");
  return receiptPdfModulePromise.then((mod) => mod.renderReceiptPdf);
}

function log(message: string, error?: unknown) {
  if (error === undefined) console.error(`[receipts] ${message}`);
  else console.error(`[receipts] ${message}:`, error);
}

// ---------------------------------------------------------------------------
// Reads (viewer's own session)

export type ReceiptSummary = {
  id: string;
  receiptNumber: string;
  issuedAt: string;
  pdfGeneratedAt: string | null;
};

type ReceiptRowDb = {
  id: string;
  receipt_number: string;
  created_at: string;
  pdf_generated_at: string | null;
};

function toSummary(row: ReceiptRowDb): ReceiptSummary {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    issuedAt: row.created_at,
    pdfGeneratedAt: row.pdf_generated_at,
  };
}

/** The receipt of one payment, if the caller may see it (Admin payment detail). */
export async function getReceiptForPayment(
  paymentId: string,
): Promise<DataResult<ReceiptSummary | null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("receipts")
      .select("id, receipt_number, created_at, pdf_generated_at")
      .eq("payment_id", paymentId)
      .maybeSingle();
    if (error) throw error;
    return { ok: true, data: data ? toSummary(data as ReceiptRowDb) : null };
  } catch (error) {
    log("Could not load a receipt", error);
    return { ok: false, error: "Could not load the receipt." };
  }
}

export type PaymentReceiptRow = {
  paymentId: string;
  paymentCode: string;
  paidAt: string | null;
  amountPaise: number;
  method: string;
  receipt: ReceiptSummary | null;
};

type PaymentWithReceiptDb = {
  id: string;
  payment_code: string;
  paid_at: string | null;
  total_amount: string | number;
  method: string;
  receipt: ReceiptRowDb | ReceiptRowDb[] | null;
};

/**
 * A Student's paid payments for one of their enrollments, each with its
 * receipt. Scoped by payments_select_own / receipts_select_own — the page
 * has already confirmed the enrollment is the caller's own.
 */
export async function getMyPaymentReceipts(
  enrollmentId: string,
): Promise<DataResult<PaymentReceiptRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("payments")
      .select(
        "id, payment_code, paid_at, total_amount, method, receipt:receipts(id, receipt_number, created_at, pdf_generated_at)",
      )
      .eq("enrollment_id", enrollmentId)
      .eq("status", "paid")
      .order("paid_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true });
    if (error) throw error;
    return {
      ok: true,
      data: ((data ?? []) as unknown as PaymentWithReceiptDb[]).map((row) => {
        const receipt = Array.isArray(row.receipt)
          ? (row.receipt[0] ?? null)
          : row.receipt;
        return {
          paymentId: row.id,
          paymentCode: row.payment_code,
          paidAt: row.paid_at,
          amountPaise: toPaise(row.total_amount),
          method: row.method,
          receipt: receipt ? toSummary(receipt) : null,
        };
      }),
    };
  } catch (error) {
    log("Could not load payments and receipts", error);
    return { ok: false, error: "Could not load your payments." };
  }
}

// ---------------------------------------------------------------------------
// Issuance (server only — callers authorize first)

export type IssuedReceipt = {
  receiptId: string;
  receiptNumber: string;
  alreadyIssued: boolean;
  pdfReady: boolean;
};

type IssueRow = {
  receipt_id: string;
  receipt_number: string;
  pdf_path: string;
  pdf_generated_at: string | null;
  already_issued: boolean;
};

type ServiceClient = ReturnType<typeof createSupabaseAdminClient>;

const NOT_PAID = "A receipt can only be issued for a paid payment.";

type SourcePaymentDb = {
  payment_code: string;
  paid_at: string | null;
  method: string;
  amount: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  internal_reference: string | null;
  razorpay_payment_id: string | null;
  student: { student_code: string; first_name: string; last_name: string } | null;
  enrollment: {
    enrollment_code: string;
    program: { name: string } | null;
    batch: { name: string } | null;
  } | null;
};

async function loadReceiptSource(
  admin: ServiceClient,
  paymentId: string,
  receipt: { receiptNumber: string; issuedAt: string },
): Promise<ReceiptSourceRow> {
  const [paymentResult, settingsResult] = await Promise.all([
    admin
      .from("payments")
      .select(
        "payment_code, paid_at, method, amount, tax_amount, total_amount, internal_reference, razorpay_payment_id, student:students(student_code, first_name, last_name), enrollment:enrollments(enrollment_code, program:programs(name), batch:batches(name))",
      )
      .eq("id", paymentId)
      .single(),
    admin
      .from("company_settings")
      .select("legal_name, address, phone, email, gstin, tax_label")
      .eq("singleton", true)
      .maybeSingle(),
  ]);
  if (paymentResult.error) throw paymentResult.error;
  if (settingsResult.error) throw settingsResult.error;
  const payment = paymentResult.data as unknown as SourcePaymentDb;
  if (!payment.student || !payment.enrollment) {
    throw new Error("Receipt source rows are incomplete");
  }
  const settings = settingsResult.data;
  if (!settings?.legal_name) throw new Error("Company legal name is not configured");

  return {
    receiptNumber: receipt.receiptNumber,
    issuedAt: receipt.issuedAt,
    payment: {
      paymentCode: payment.payment_code,
      paidAt: payment.paid_at,
      method: payment.method,
      amountPaise: toPaise(payment.amount),
      taxAmountPaise: toPaise(payment.tax_amount),
      totalPaise: toPaise(payment.total_amount),
      internalReference: payment.internal_reference,
      providerPaymentId: payment.razorpay_payment_id,
    },
    student: {
      studentCode: payment.student.student_code,
      firstName: payment.student.first_name,
      lastName: payment.student.last_name,
    },
    enrollment: {
      enrollmentCode: payment.enrollment.enrollment_code,
      programName: payment.enrollment.program?.name ?? "—",
      batchName: payment.enrollment.batch?.name ?? null,
    },
    company: {
      legalName: settings.legal_name,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      gstin: settings.gstin,
      taxLabel: settings.tax_label,
    },
  };
}

async function generateReceiptPdf(
  admin: ServiceClient,
  paymentId: string,
  row: IssueRow,
): Promise<void> {
  const { data: receipt, error } = await admin
    .from("receipts")
    .select("created_at")
    .eq("id", row.receipt_id)
    .single();
  if (error) throw error;

  const source = await loadReceiptSource(admin, paymentId, {
    receiptNumber: row.receipt_number,
    issuedAt: receipt.created_at as string,
  });
  const renderReceiptPdf = await loadRenderReceiptPdf();
  const pdf = await renderReceiptPdf(buildReceiptDocument(source));

  // Same path every attempt; upsert so a retry after a partial failure (or
  // a concurrent first download) simply rewrites the identical document.
  const { error: uploadError } = await admin.storage
    .from(RECEIPTS_BUCKET)
    .upload(row.pdf_path, pdf, { contentType: "application/pdf", upsert: true });
  if (uploadError) throw uploadError;

  const { error: markError } = await admin
    .from("receipts")
    .update({ pdf_generated_at: new Date().toISOString() })
    .eq("id", row.receipt_id)
    .is("pdf_generated_at", null);
  if (markError) throw markError;
}

/** issue_receipt(): reserves (or returns) the payment's receipt. */
async function callIssueReceipt(
  paymentId: string,
): Promise<DataResult<{ admin: ServiceClient; row: IssueRow }>> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("issue_receipt", { p_payment_id: paymentId });
    if (error) {
      if (error.code === "P2101") return { ok: false, error: NOT_PAID };
      if (error.code === "P2104") return { ok: false, error: "Payment not found." };
      throw error;
    }
    const first = (data as IssueRow[] | null)?.[0];
    if (!first) throw new Error("issue_receipt returned no row");
    return { ok: true, data: { admin, row: first } };
  } catch (error) {
    log("Could not issue a receipt", error);
    return { ok: false, error: "The receipt could not be issued. Please try again." };
  }
}

function toIssued(row: IssueRow): IssuedReceipt {
  return {
    receiptId: row.receipt_id,
    receiptNumber: row.receipt_number,
    alreadyIssued: row.already_issued,
    pdfReady: row.pdf_generated_at !== null,
  };
}

/**
 * Issue (idempotently) the receipt of a paid payment and make sure its PDF
 * exists. Never trusts a caller-supplied amount or identity: everything
 * printed is read from the database by payment id. Callers must have
 * authorized the request (Admin, the paying Student via RLS, or a
 * signature-verified Razorpay confirmation).
 */
export async function ensureReceiptForPayment(
  paymentId: string,
): Promise<DataResult<IssuedReceipt>> {
  const issuedRow = await callIssueReceipt(paymentId);
  if (!issuedRow.ok) return issuedRow;
  const { admin, row } = issuedRow.data;

  const issued = toIssued(row);
  if (issued.pdfReady) return { ok: true, data: issued };

  try {
    await generateReceiptPdf(admin, paymentId, row);
    return { ok: true, data: { ...issued, pdfReady: true } };
  } catch (error) {
    // The number stays reserved on its row; the next attempt retries the
    // same path. Reported as issued-but-pending, never as a new receipt.
    log(
      `Receipt ${row.receipt_number} was issued but its PDF could not be generated`,
      error,
    );
    return { ok: true, data: issued };
  }
}

/**
 * Offline recording path: reserve the receipt number now — one fast,
 * idempotent database call, so the payment page shows it straight away —
 * and render/upload the PDF after the response. The Admin's redirect to
 * the recorded payment is therefore never delayed by document work (the
 * Phase 20A redirect timing is preserved) and never fails because of it.
 * If the deferred PDF step fails, the number stays reserved and the
 * download route or "Retry PDF generation" completes it.
 */
export async function issueReceiptNow(
  paymentId: string,
): Promise<DataResult<IssuedReceipt>> {
  const issuedRow = await callIssueReceipt(paymentId);
  if (!issuedRow.ok) return issuedRow;
  const issued = toIssued(issuedRow.data.row);
  if (!issued.pdfReady) queueReceiptIssuance(paymentId);
  return { ok: true, data: issued };
}

/**
 * Razorpay paths: issue after the response has been sent, so a webhook or
 * Checkout confirmation is never slowed or failed by PDF work. If this
 * attempt fails, the download route and the Admin action recover.
 */
export function queueReceiptIssuance(paymentId: string): void {
  after(async () => {
    const result = await ensureReceiptForPayment(paymentId);
    // A redelivery for a held (not paid) capture is refused by design.
    if (!result.ok && result.error !== NOT_PAID) {
      log(`Queued receipt issuance failed: ${result.error}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Download (viewer's own session)

export type ReceiptPdf = { fileName: string; bytes: Uint8Array };

export type ReceiptPdfFailure = "not_found" | "not_eligible" | "pending" | "error";

export type ReceiptPdfResult =
  | { ok: true; data: ReceiptPdf }
  | { ok: false; reason: ReceiptPdfFailure; error: string };

const FAILURE_MESSAGES: Record<ReceiptPdfFailure, string> = {
  not_found: "Receipt not found.",
  not_eligible: "No receipt is available for this payment.",
  pending: "The receipt is being prepared. Please try again shortly.",
  error: "The receipt could not be downloaded. Please try again.",
};

function failure(reason: ReceiptPdfFailure): ReceiptPdfResult {
  return { ok: false, reason, error: FAILURE_MESSAGES[reason] };
}

/**
 * The receipt PDF of one payment for the signed-in viewer. The payment is
 * read through the viewer's RLS session first, so another Student's
 * payment id resolves exactly like a nonexistent one. A paid payment
 * without a stored PDF is issued/generated on demand (idempotent), then
 * the object is read back through the same RLS session.
 */
export async function getReceiptPdfForViewer(
  paymentId: string,
): Promise<ReceiptPdfResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("id, status")
      .eq("id", paymentId)
      .maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return failure("not_found");
    if (!isReceiptEligible(payment.status as string)) return failure("not_eligible");

    const readReceipt = async () => {
      const { data, error } = await supabase
        .from("receipts")
        .select("receipt_number, pdf_path, pdf_generated_at")
        .eq("payment_id", paymentId)
        .maybeSingle();
      if (error) throw error;
      return data as {
        receipt_number: string;
        pdf_path: string;
        pdf_generated_at: string | null;
      } | null;
    };

    let receipt = await readReceipt();
    if (!receipt?.pdf_generated_at) {
      const ensured = await ensureReceiptForPayment(paymentId);
      if (!ensured.ok) return failure("error");
      if (!ensured.data.pdfReady) return failure("pending");
      receipt = await readReceipt();
      if (!receipt) return failure("not_found");
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from(RECEIPTS_BUCKET)
      .download(receipt.pdf_path);
    if (downloadError) throw downloadError;
    if (!blob) return failure("not_found");

    return {
      ok: true,
      data: {
        fileName: receiptFileName(receipt.receipt_number),
        bytes: new Uint8Array(await blob.arrayBuffer()),
      },
    };
  } catch (error) {
    log("Could not load a receipt PDF", error);
    return failure("error");
  }
}
