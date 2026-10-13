import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DataResult } from "@/lib/data/dashboard";
import { getEnrollmentFinancialSummary } from "@/lib/data/enrollments";
import { toPaise } from "@/lib/domain/money";
import { rupeeStringToPaise } from "@/lib/domain/payments";
import type { RefundStatus } from "@/lib/domain/refunds";
import { getRazorpayKeys } from "@/lib/payments/razorpay-config";
import {
  createRazorpayGateway,
  isDefinitiveRejection,
  type GatewayRefund,
} from "@/lib/payments/razorpay-gateway";
import type {
  InitiateRazorpayRefundInput,
  RecordOfflineRefundInput,
} from "@/lib/validation/refunds";

/**
 * Phase 21B (Refunds) data layer — FR-97, SEC-10. One canonical ledger,
 * `payment_refunds`, for offline and Razorpay TEST-mode refunds.
 *
 * Writes only through the database functions of 20260101000038:
 *  - record_offline_refund (Admin session): money already returned for an
 *    offline payment, inserted directly as `processed`;
 *  - reserve_razorpay_refund (Admin session): reserves capacity as an
 *    `initiated` row BEFORE Razorpay is called, so a crash, timeout or
 *    double click can never produce an unrecorded or duplicate refund;
 *  - apply_razorpay_refund_status (service_role): Razorpay's own answer
 *    (API response, `refund.processed` / `refund.failed` webhook, or a
 *    reconciliation fetch) moves initiated → processed | failed, once;
 *  - fail_unsent_razorpay_refund (service_role): releases a reservation
 *    Razorpay definitively never created.
 * The cumulative cap, payment eligibility and immutability are enforced in
 * the database under a payment row lock. Nothing here touches payments,
 * enrollments, installments or receipts.
 *
 * The Razorpay payment id sent to Razorpay is the one the database returns
 * from the payment row — never a browser value. Our refund id travels to
 * Razorpay as `receipt` and in `notes.roicians_refund_id`, so a provider
 * refund can always be matched back even if the API response was lost.
 */

const REFUND_NOTE_KEY = "roicians_refund_id";
/** A reservation older than this with no provider refund may be released. */
const UNSENT_RELEASE_AFTER_MS = 10 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function log(message: string, error?: unknown) {
  if (error === undefined) console.error(`[refunds] ${message}`);
  else console.error(`[refunds] ${message}:`, error);
}

// ---------------------------------------------------------------------------
// Reads (viewer's own RLS session)

export type RefundRow = {
  id: string;
  amountPaise: number;
  status: RefundStatus;
  reason: string;
  reference: string | null;
  refundedOn: string | null;
  providerRefundId: string | null;
  createdAt: string;
  initiatedByName: string | null;
};

type RefundRowDb = {
  id: string;
  amount: string | number;
  status: RefundStatus;
  reason: string;
  reference: string | null;
  refunded_on: string | null;
  razorpay_refund_id: string | null;
  created_at: string;
  initiator: { first_name: string; last_name: string } | null;
};

export const REFUND_SELECT =
  "id, amount, status, reason, reference, refunded_on, razorpay_refund_id, created_at, initiator:admins!payment_refunds_initiated_by_fkey(first_name, last_name)";

export function toRefundRow(row: RefundRowDb): RefundRow {
  return {
    id: row.id,
    amountPaise: toPaise(row.amount),
    status: row.status,
    reason: row.reason,
    reference: row.reference,
    refundedOn: row.refunded_on,
    providerRefundId: row.razorpay_refund_id,
    createdAt: row.created_at,
    initiatedByName: row.initiator
      ? `${row.initiator.first_name} ${row.initiator.last_name}`.trim()
      : null,
  };
}

/** Every refund of one payment the caller may see, newest first. */
export async function getPaymentRefunds(
  paymentId: string,
): Promise<DataResult<RefundRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("payment_refunds")
      .select(REFUND_SELECT)
      .eq("payment_id", paymentId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
    if (error) throw error;
    return {
      ok: true,
      data: ((data ?? []) as unknown as RefundRowDb[]).map(toRefundRow),
    };
  } catch (error) {
    log("Could not load refunds", error);
    return { ok: false, error: "Could not load refunds." };
  }
}

/** The enrollment's live Phase 14 outstanding (for the refund preview). */
export async function getEnrollmentOutstandingPaise(
  enrollmentId: string,
): Promise<DataResult<number>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("enrollments")
      .select("total_payable")
      .eq("id", enrollmentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "Enrollment not found." };
    const summary = await getEnrollmentFinancialSummary(
      enrollmentId,
      String(data.total_payable),
    );
    if (!summary.ok) return summary;
    return { ok: true, data: summary.data.outstandingPaise };
  } catch (error) {
    log("Could not load the outstanding balance", error);
    return { ok: false, error: "Could not load the outstanding balance." };
  }
}

// ---------------------------------------------------------------------------
// Offline refund (Admin session)

const BUSINESS_RULE_CODES = new Set(["22023", "P2101", "P2102", "P2103"]);

function businessError(error: { code?: string; message?: string }): string | null {
  if (error.code && BUSINESS_RULE_CODES.has(error.code)) {
    return `${error.message}.`.replace(/\.\.$/, ".");
  }
  if (error.code === "P2104") return "Payment not found.";
  if (error.code === "42501") return "You are not authorized to refund payments.";
  return null;
}

export type RecordedRefund = { id: string; alreadyRecorded: boolean };

export async function recordOfflineRefund(
  input: RecordOfflineRefundInput,
): Promise<DataResult<RecordedRefund>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("record_offline_refund", {
      p_refund_id: input.refundId,
      p_payment_id: input.paymentId,
      p_amount: input.amount,
      p_reason: input.reason,
      p_refunded_on: input.refundedOn,
      p_reference: input.reference,
    });
    if (error) {
      const message = businessError(error);
      if (message) return { ok: false, error: message };
      throw error;
    }
    const row = (
      data as Array<{ refund_id: string; already_recorded: boolean }> | null
    )?.[0];
    if (!row) throw new Error("record_offline_refund returned no row");
    return {
      ok: true,
      data: { id: row.refund_id, alreadyRecorded: row.already_recorded },
    };
  } catch (error) {
    log("Could not record an offline refund", error);
    return { ok: false, error: "The refund could not be recorded. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Razorpay refund

export type RazorpayRefundResult = {
  id: string;
  /** The refund's state after this request. */
  status: RefundStatus;
  /** A repeated submission of the same form (nothing new was sent). */
  alreadyReserved: boolean;
  /** Razorpay's answer was not received; confirmation will follow. */
  awaitingConfirmation: boolean;
};

type ReserveRow = {
  refund_id: string;
  provider_payment_id: string;
  status: RefundStatus;
  razorpay_refund_id: string | null;
  already_reserved: boolean;
};

const PROVIDER_UNAVAILABLE =
  "Online refunds are unavailable right now. No money was refunded.";
const PROVIDER_DECLINED = "Razorpay declined this refund. No money was refunded.";

type ApplyOutcome =
  | "processed"
  | "failed"
  | "pending"
  | "already_final"
  | "conflict"
  | "unknown_payment"
  | "unknown_refund"
  | "payment_mismatch"
  | "amount_mismatch";

async function applyProviderRefund(
  refundId: string | null,
  refund: GatewayRefund,
  source: "api" | "webhook" | "sync",
): Promise<ApplyOutcome> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("apply_razorpay_refund_status", {
    p_refund_id: refundId,
    p_provider_payment_id: refund.paymentId,
    p_provider_refund_id: refund.id,
    p_amount_paise: refund.amountPaise,
    p_currency: refund.currency,
    p_provider_status: refund.status,
    p_source: source,
  });
  if (error) throw error;
  const row = (
    data as Array<{ refund_id: string | null; outcome: ApplyOutcome }> | null
  )?.[0];
  if (!row) throw new Error("apply_razorpay_refund_status returned no row");
  return row.outcome;
}

async function releaseUnsent(refundId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("fail_unsent_razorpay_refund", {
    p_refund_id: refundId,
  });
  if (error) throw error;
  return data === true;
}

async function currentStatus(refundId: string): Promise<RefundStatus> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("payment_refunds")
    .select("status")
    .eq("id", refundId)
    .single();
  if (error) throw error;
  return data.status as RefundStatus;
}

export async function initiateRazorpayRefund(
  input: InitiateRazorpayRefundInput,
): Promise<DataResult<RazorpayRefundResult>> {
  let reserved: ReserveRow;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("reserve_razorpay_refund", {
      p_refund_id: input.refundId,
      p_payment_id: input.paymentId,
      p_amount: input.amount,
      p_reason: input.reason,
    });
    if (error) {
      const message = businessError(error);
      if (message) return { ok: false, error: message };
      throw error;
    }
    const row = (data as ReserveRow[] | null)?.[0];
    if (!row) throw new Error("reserve_razorpay_refund returned no row");
    reserved = row;
  } catch (error) {
    log("Could not reserve a Razorpay refund", error);
    return { ok: false, error: "The refund could not be started. Please try again." };
  }

  // A repeated submission never calls Razorpay a second time.
  if (reserved.already_reserved) {
    return {
      ok: true,
      data: {
        id: reserved.refund_id,
        status: reserved.status,
        alreadyReserved: true,
        awaitingConfirmation: reserved.status === "initiated",
      },
    };
  }

  const keys = getRazorpayKeys();
  if (!keys.ok) {
    log(`Razorpay is not configured (${keys.reason})`);
    try {
      await releaseUnsent(reserved.refund_id);
    } catch (error) {
      log("Could not release an unsent refund reservation", error);
    }
    return { ok: false, error: PROVIDER_UNAVAILABLE };
  }

  const amountPaise = rupeeStringToPaise(input.amount);
  if (amountPaise === null) {
    return { ok: false, error: "Refund amount must be greater than zero." };
  }

  let providerRefund: GatewayRefund;
  try {
    providerRefund = await createRazorpayGateway(keys.keys).createRefund({
      paymentId: reserved.provider_payment_id,
      amountPaise,
      receipt: reserved.refund_id,
      notes: { [REFUND_NOTE_KEY]: reserved.refund_id },
    });
  } catch (error) {
    if (isDefinitiveRejection(error)) {
      log("Razorpay rejected a refund request", error);
      try {
        await releaseUnsent(reserved.refund_id);
      } catch (releaseError) {
        log("Could not release a rejected refund reservation", releaseError);
      }
      return { ok: false, error: PROVIDER_DECLINED };
    }
    // Unknown outcome: the reservation stays; the webhook or a status check
    // completes it. Never retried blindly.
    log("No answer from Razorpay for a refund request", error);
    return {
      ok: true,
      data: {
        id: reserved.refund_id,
        status: "initiated",
        alreadyReserved: false,
        awaitingConfirmation: true,
      },
    };
  }

  try {
    const outcome = await applyProviderRefund(reserved.refund_id, providerRefund, "api");
    if (outcome !== "processed" && outcome !== "failed" && outcome !== "pending") {
      log(`Razorpay refund response could not be applied (${outcome})`);
    }
    const status = await currentStatus(reserved.refund_id);
    return {
      ok: true,
      data: {
        id: reserved.refund_id,
        status,
        alreadyReserved: false,
        awaitingConfirmation: status === "initiated",
      },
    };
  } catch (error) {
    log("Could not record Razorpay's refund response", error);
    return {
      ok: true,
      data: {
        id: reserved.refund_id,
        status: "initiated",
        alreadyReserved: false,
        awaitingConfirmation: true,
      },
    };
  }
}

/**
 * Admin "Check status with Razorpay": reconciles one in-progress refund
 * from Razorpay's own list for the payment (matched by provider refund id
 * or by our refund id in notes). A reservation Razorpay never created is
 * released only after UNSENT_RELEASE_AFTER_MS, so an in-flight request is
 * never mistaken for a lost one.
 */
export async function syncRazorpayRefund(
  refundId: string,
  now: Date = new Date(),
): Promise<DataResult<{ status: RefundStatus }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("payment_refunds")
      .select(
        "id, status, razorpay_refund_id, created_at, payment:payments(razorpay_payment_id)",
      )
      .eq("id", refundId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "Refund not found." };
    const row = data as unknown as {
      id: string;
      status: RefundStatus;
      razorpay_refund_id: string | null;
      created_at: string;
      payment: { razorpay_payment_id: string | null } | null;
    };
    if (row.status !== "initiated") return { ok: true, data: { status: row.status } };
    const providerPaymentId = row.payment?.razorpay_payment_id;
    if (!providerPaymentId) return { ok: false, error: "This is not a Razorpay refund." };

    const keys = getRazorpayKeys();
    if (!keys.ok) return { ok: false, error: PROVIDER_UNAVAILABLE };

    const refunds = await createRazorpayGateway(keys.keys).listRefunds(providerPaymentId);
    const match = refunds.find(
      (r) =>
        (row.razorpay_refund_id !== null && r.id === row.razorpay_refund_id) ||
        r.notes[REFUND_NOTE_KEY] === row.id,
    );
    if (match) {
      await applyProviderRefund(row.id, match, "sync");
    } else if (
      row.razorpay_refund_id === null &&
      now.getTime() - new Date(row.created_at).getTime() > UNSENT_RELEASE_AFTER_MS
    ) {
      await releaseUnsent(row.id);
    }
    return { ok: true, data: { status: await currentStatus(row.id) } };
  } catch (error) {
    log("Could not check a refund with Razorpay", error);
    return {
      ok: false,
      error: "Could not check the refund with Razorpay. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// Webhook (signature already verified by the caller)

export type RefundWebhookEntity = {
  id?: unknown;
  payment_id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  notes?: unknown;
};

/**
 * Applies a signature-verified `refund.processed` / `refund.failed` event.
 * Returns the outcome stored in the webhook log. The payment is resolved
 * from the entity's provider payment id against the stored ledger, and the
 * refund from its provider id or our id in notes — an event for a refund
 * this system did not initiate records nothing.
 */
export async function applyRefundWebhook(entity: RefundWebhookEntity): Promise<string> {
  if (
    typeof entity.id !== "string" ||
    typeof entity.payment_id !== "string" ||
    typeof entity.amount !== "number" ||
    typeof entity.currency !== "string" ||
    typeof entity.status !== "string"
  ) {
    return "ignored_incomplete";
  }
  const notes =
    entity.notes && typeof entity.notes === "object" && !Array.isArray(entity.notes)
      ? (entity.notes as Record<string, unknown>)
      : {};
  const noted = notes[REFUND_NOTE_KEY];
  const refundId = typeof noted === "string" && UUID_PATTERN.test(noted) ? noted : null;
  return applyProviderRefund(
    refundId,
    {
      id: entity.id,
      paymentId: entity.payment_id,
      amountPaise: entity.amount,
      currency: entity.currency,
      status: entity.status,
      notes: {},
    },
    "webhook",
  );
}
