import "server-only";

import { randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { queueReceiptIssuance } from "@/lib/data/receipts";
import type { DataResult } from "@/lib/data/dashboard";
import { getMyEnrollment } from "@/lib/data/student-portal";
import { getPaymentPlanForEnrollment } from "@/lib/data/payment-plans";
import { toPaise } from "@/lib/domain/money";
import { canReceiveOfflinePayment } from "@/lib/domain/payments";
import { paiseToDecimalString } from "@/lib/domain/reports";
import {
  ONLINE_ORDER_TTL_MINUTES,
  buildOnlinePaymentOptions,
  buildOrderReceipt,
  computeNextInstallmentDue,
  type OnlinePaymentOption,
  type OnlinePaymentPurpose,
} from "@/lib/domain/online-payments";
import {
  getRazorpayKeys,
  getRazorpayWebhookSecret,
} from "@/lib/payments/razorpay-config";
import { createRazorpayGateway } from "@/lib/payments/razorpay-gateway";
import {
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "@/lib/payments/razorpay-signature";
import type { CheckoutResultInput } from "@/lib/validation/online-payments";

/**
 * Phase 20B data layer — the server side of Razorpay Standard Checkout.
 *
 * Trust boundary: the browser supplies only an enrollment id + purpose
 * (order creation) and Razorpay's own Checkout result (verification). The
 * amount always comes from the Phase 14 engine (getMyEnrollment →
 * getEnrollmentFinancialSummary) and the plan's oldest-first coverage;
 * ownership comes from the Student's own RLS-scoped session; success comes
 * only from Razorpay — a valid HMAC signature AND the payment fetched from
 * Razorpay's API reporting `captured`, or a signature-verified
 * `payment.captured` webhook. Either path ends in the same database
 * function, finalize_razorpay_payment(), which is idempotent on the
 * Razorpay payment id, so callback/webhook order and repetition never
 * produce a second ledger row.
 *
 * The service-role client is used only for the three service_role-only
 * operations (register order, read an order by provider id, finalize) and
 * the webhook log — never handed to the browser, never used for a read the
 * Student's own session can do.
 *
 * Errors shown to a Student are generic; provider/internal detail goes to
 * the server log without secrets, signatures or payloads.
 */

const GENERIC_ERROR = "Online payment is unavailable right now. Please try again later.";

function log(message: string, error?: unknown) {
  const detail =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : error
        ? String(error)
        : "";
  console.error(`[online payments] ${message}${detail ? `: ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// Quote (what the Student may pay)

export type OnlinePaymentQuote = {
  enrollmentId: string;
  enrollmentCode: string;
  programCode: string;
  outstandingPaise: number;
  eligible: boolean;
  options: OnlinePaymentOption[];
};

export async function getMyOnlinePaymentQuote(
  enrollmentId: string,
): Promise<DataResult<OnlinePaymentQuote>> {
  const enrollment = await getMyEnrollment(enrollmentId);
  if (!enrollment.ok) return enrollment;
  const row = enrollment.data;

  const eligible = canReceiveOfflinePayment(row.status);
  if (!eligible || row.outstandingPaise <= 0) {
    return {
      ok: true,
      data: {
        enrollmentId: row.id,
        enrollmentCode: row.enrollmentCode,
        programCode: row.programCode,
        outstandingPaise: row.outstandingPaise,
        eligible,
        options: [],
      },
    };
  }

  const plan = await getPaymentPlanForEnrollment(row.id);
  if (!plan.ok) return plan;

  // Outstanding > 0 here, so payable − outstanding is exactly net paid
  // (paid − processed refunds) from the same Phase 14 summary.
  const netPaidPaise = row.totalPayablePaise - row.outstandingPaise;
  const nextInstallment = plan.data
    ? computeNextInstallmentDue(
        plan.data.installments,
        netPaidPaise,
        row.outstandingPaise,
      )
    : null;

  return {
    ok: true,
    data: {
      enrollmentId: row.id,
      enrollmentCode: row.enrollmentCode,
      programCode: row.programCode,
      outstandingPaise: row.outstandingPaise,
      eligible,
      options: buildOnlinePaymentOptions({
        outstandingPaise: row.outstandingPaise,
        nextInstallment,
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Order creation

export type CheckoutPayload = {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: "INR";
  enrollmentCode: string;
  description: string;
};

type OpenOrderRow = {
  provider_order_id: string;
  purpose: OnlinePaymentPurpose;
  installment_id: string | null;
  amount: string | number;
};

export async function createMyOnlineOrder(input: {
  enrollmentId: string;
  purpose: OnlinePaymentPurpose;
  studentId: string;
  authUserId: string;
}): Promise<DataResult<CheckoutPayload>> {
  const keys = getRazorpayKeys();
  if (!keys.ok) {
    log(`Razorpay is not configured (${keys.reason})`);
    return { ok: false, error: GENERIC_ERROR };
  }

  const quote = await getMyOnlinePaymentQuote(input.enrollmentId);
  if (!quote.ok) return quote;
  const option = quote.data.options.find((o) => o.purpose === input.purpose);
  if (!option) {
    return {
      ok: false,
      error:
        "This payment option is no longer available. Refresh the page and try again.",
    };
  }
  const description = `${quote.data.enrollmentCode} — ${option.label}`;

  try {
    const admin = createSupabaseAdminClient();

    // A repeat click reuses the still-valid open order for the same amount
    // instead of creating another Razorpay order.
    const { data: open, error: openError } = await admin
      .from("payment_orders")
      .select("provider_order_id, purpose, installment_id, amount")
      .eq("enrollment_id", quote.data.enrollmentId)
      .eq("student_id", input.studentId)
      .eq("status", "created")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (openError) throw openError;
    const reusable = open as OpenOrderRow | null;
    if (
      reusable &&
      reusable.purpose === option.purpose &&
      reusable.installment_id === option.installmentId &&
      toPaise(reusable.amount) === option.amountPaise
    ) {
      return {
        ok: true,
        data: {
          keyId: keys.keys.keyId,
          orderId: reusable.provider_order_id,
          amountPaise: option.amountPaise,
          currency: "INR",
          enrollmentCode: quote.data.enrollmentCode,
          description,
        },
      };
    }

    const gateway = createRazorpayGateway(keys.keys);
    const order = await gateway.createOrder({
      amountPaise: option.amountPaise,
      receipt: buildOrderReceipt(
        quote.data.enrollmentCode,
        new Date(),
        randomBytes(3).toString("hex"),
      ),
      // API_AND_INTEGRATIONS.md §2.9: codes only, no name/phone/email.
      notes: {
        enrollment_code: quote.data.enrollmentCode,
        program_code: quote.data.programCode,
        purpose: option.purpose,
      },
    });
    if (order.amountPaise !== option.amountPaise || order.currency !== "INR") {
      log("Razorpay returned an order that does not match the requested amount");
      return { ok: false, error: GENERIC_ERROR };
    }

    const { error: registerError } = await admin.rpc("register_razorpay_order", {
      p_provider_order_id: order.id,
      p_enrollment_id: quote.data.enrollmentId,
      p_student_id: input.studentId,
      p_purpose: option.purpose,
      p_installment_id: option.installmentId,
      p_amount: paiseToDecimalString(option.amountPaise),
      p_created_by_auth_user_id: input.authUserId,
      p_ttl_minutes: ONLINE_ORDER_TTL_MINUTES,
    });
    if (registerError) {
      if (registerError.code === "P2001" || registerError.code === "P2002") {
        return {
          ok: false,
          error: "Your balance has changed. Refresh the page and try again.",
        };
      }
      throw registerError;
    }

    return {
      ok: true,
      data: {
        keyId: keys.keys.keyId,
        orderId: order.id,
        amountPaise: option.amountPaise,
        currency: "INR",
        enrollmentCode: quote.data.enrollmentCode,
        description,
      },
    };
  } catch (error) {
    log("Could not create a Razorpay order", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

// ---------------------------------------------------------------------------
// Finalization (shared by Checkout verification and the webhook)

export type FinalizeOutcome = "recorded" | "already_recorded" | "held" | "unknown_order";

type FinalizeRow = {
  payment_id: string | null;
  payment_code: string | null;
  outcome: FinalizeOutcome;
};

async function finalizeCaptured(input: {
  providerOrderId: string;
  providerPaymentId: string;
  amountPaise: number;
  currency: string;
  createdAtUnix: number | null;
  source: "checkout" | "webhook";
}): Promise<FinalizeRow> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("finalize_razorpay_payment", {
    p_provider_order_id: input.providerOrderId,
    p_provider_payment_id: input.providerPaymentId,
    p_amount_paise: input.amountPaise,
    p_currency: input.currency,
    p_provider_status: "captured",
    p_paid_at: input.createdAtUnix
      ? new Date(input.createdAtUnix * 1000).toISOString()
      : new Date().toISOString(),
    p_source: input.source,
  });
  if (error) throw error;
  const row = (data as FinalizeRow[] | null)?.[0];
  if (!row) throw new Error("finalize_razorpay_payment returned no row");
  // Phase 21A: a payment that is now canonically paid gets its receipt,
  // after the response (idempotent — a redelivery reuses the receipt).
  // Held captures are not paid and get none.
  if (
    (row.outcome === "recorded" || row.outcome === "already_recorded") &&
    row.payment_id
  ) {
    queueReceiptIssuance(row.payment_id);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Checkout completion (Student session)

export type CheckoutVerification =
  | { status: "paid"; paymentCode: string; enrollmentId: string }
  | { status: "held"; enrollmentId: string }
  | { status: "processing"; enrollmentId: string }
  | { status: "failed"; message: string };

const VERIFY_FAILED =
  "We could not confirm this payment. If money was deducted, it will be reconciled automatically — please check again shortly.";

export async function verifyMyCheckout(input: {
  checkout: CheckoutResultInput;
  studentId: string;
}): Promise<CheckoutVerification> {
  const keys = getRazorpayKeys();
  if (!keys.ok) {
    log(`Razorpay is not configured (${keys.reason})`);
    return { status: "failed", message: VERIFY_FAILED };
  }
  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
  } = input.checkout;

  if (
    !verifyCheckoutSignature({
      orderId,
      paymentId,
      signature,
      keySecret: keys.keys.keySecret,
    })
  ) {
    log("Rejected a Checkout result with an invalid signature");
    return { status: "failed", message: VERIFY_FAILED };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: order, error: orderError } = await admin
      .from("payment_orders")
      .select("enrollment_id, student_id")
      .eq("provider_order_id", orderId)
      .maybeSingle();
    if (orderError) throw orderError;
    // Unknown order or someone else's order: same generic answer.
    if (!order || order.student_id !== input.studentId) {
      log("Checkout result references an order not owned by the caller");
      return { status: "failed", message: VERIFY_FAILED };
    }
    const enrollmentId = order.enrollment_id as string;

    const gateway = createRazorpayGateway(keys.keys);
    const payment = await gateway.fetchPayment(paymentId);
    if (payment.id !== paymentId || payment.orderId !== orderId) {
      log("Fetched payment does not belong to the signed order");
      return { status: "failed", message: VERIFY_FAILED };
    }
    if (payment.status === "authorized" || payment.status === "created") {
      return { status: "processing", enrollmentId };
    }
    if (payment.status !== "captured") {
      return {
        status: "failed",
        message: "The payment did not go through. No money has been recorded.",
      };
    }

    const result = await finalizeCaptured({
      providerOrderId: orderId,
      providerPaymentId: paymentId,
      amountPaise: payment.amountPaise,
      currency: payment.currency,
      createdAtUnix: payment.createdAtUnix,
      source: "checkout",
    });
    if (result.outcome === "held") return { status: "held", enrollmentId };
    if (result.outcome === "unknown_order" || !result.payment_code) {
      return { status: "failed", message: VERIFY_FAILED };
    }
    return { status: "paid", paymentCode: result.payment_code, enrollmentId };
  } catch (error) {
    log("Could not verify a Checkout result", error);
    return { status: "failed", message: VERIFY_FAILED };
  }
}

// ---------------------------------------------------------------------------
// Webhook (no session; authenticated by Razorpay's signature)

export type WebhookResult = { httpStatus: number; outcome: string };

type CapturedEntity = {
  id?: unknown;
  order_id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  created_at?: unknown;
};

export async function processRazorpayWebhook(input: {
  rawBody: string;
  signature: string | null;
  eventIdHeader: string | null;
}): Promise<WebhookResult> {
  const secret = getRazorpayWebhookSecret();
  if (!secret) {
    log("Webhook received but RAZORPAY_WEBHOOK_SECRET is not configured");
    return { httpStatus: 503, outcome: "not_configured" };
  }
  if (
    !verifyWebhookSignature({
      rawBody: input.rawBody,
      signature: input.signature,
      webhookSecret: secret,
    })
  ) {
    log("Rejected a webhook with an invalid signature");
    return { httpStatus: 400, outcome: "invalid_signature" };
  }

  let body: { event?: unknown; payload?: { payment?: { entity?: CapturedEntity } } };
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return { httpStatus: 400, outcome: "invalid_json" };
  }
  const eventType = typeof body.event === "string" ? body.event : "unknown";
  const entity = body.payload?.payment?.entity ?? {};
  const paymentId = typeof entity.id === "string" ? entity.id : null;
  const orderId = typeof entity.order_id === "string" ? entity.order_id : null;
  const eventId =
    input.eventIdHeader?.trim() || `${eventType}:${paymentId ?? "no-payment"}`;

  try {
    const admin = createSupabaseAdminClient();
    const { error: insertError } = await admin.from("razorpay_webhook_events").upsert(
      {
        event_id: eventId,
        event_type: eventType,
        provider_order_id: orderId,
        provider_payment_id: paymentId,
      },
      { onConflict: "event_id", ignoreDuplicates: true },
    );
    if (insertError) throw insertError;
    const { data: logged, error: readError } = await admin
      .from("razorpay_webhook_events")
      .select("processed_at")
      .eq("event_id", eventId)
      .maybeSingle();
    if (readError) throw readError;
    if (logged?.processed_at) return { httpStatus: 200, outcome: "duplicate" };

    let outcome: string;
    if (eventType !== "payment.captured") {
      outcome = "ignored";
    } else if (
      !paymentId ||
      !orderId ||
      entity.status !== "captured" ||
      typeof entity.amount !== "number" ||
      typeof entity.currency !== "string"
    ) {
      outcome = "ignored_incomplete";
    } else {
      const result = await finalizeCaptured({
        providerOrderId: orderId,
        providerPaymentId: paymentId,
        amountPaise: entity.amount,
        currency: entity.currency,
        createdAtUnix: typeof entity.created_at === "number" ? entity.created_at : null,
        source: "webhook",
      });
      outcome = result.outcome;
    }

    const { error: doneError } = await admin
      .from("razorpay_webhook_events")
      .update({ outcome, processed_at: new Date().toISOString() })
      .eq("event_id", eventId);
    if (doneError) throw doneError;
    return { httpStatus: 200, outcome };
  } catch (error) {
    // Non-2xx makes Razorpay redeliver; finalization is idempotent.
    log("Could not process a webhook delivery", error);
    return { httpStatus: 500, outcome: "error" };
  }
}
