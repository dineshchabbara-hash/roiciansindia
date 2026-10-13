/**
 * Phase 21B (Refunds) — pure rules, no I/O.
 *
 * The database is the authority (20260101000038_refund_workflow.sql):
 * record_offline_refund / reserve_razorpay_refund enforce the cap under a
 * payment row lock, apply_razorpay_refund_status applies provider truth.
 * This module only derives what the UI shows and offers.
 *
 * Accounting (DECISIONS_NEEDED.md D8, option A — the unchanged Phase 14
 * formula): outstanding = total_payable − paid + processed refunds. Only a
 * `processed` refund is financial truth. An `initiated` refund reserves
 * refundable capacity but does not change outstanding; a `failed` refund
 * changes nothing. A refund records money returned — it never reduces the
 * student's contractual payable (no fee adjustment / waiver exists; that is
 * a separate, not-yet-approved requirement).
 *
 * The original payment stays `paid` forever; "partially / fully refunded"
 * is a derived display label only.
 */

export const REFUND_STATUSES = ["initiated", "processed", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  initiated: "In progress",
  processed: "Refunded",
  failed: "Failed",
};

export function refundStatusLabel(status: string): string {
  return REFUND_STATUS_LABELS[status as RefundStatus] ?? status;
}

/** Refund channel follows the payment's origin. */
export type RefundChannel = "offline" | "razorpay";

export function refundChannelFor(paymentMethod: string): RefundChannel {
  return paymentMethod === "razorpay" ? "razorpay" : "offline";
}

export type RefundLike = { amountPaise: number; status: string };

export type PaymentRefundSummary = {
  paymentPaise: number;
  /** Processed refunds — financial truth. */
  refundedPaise: number;
  /** Initiated (in-progress) refunds — reserved, not yet financial truth. */
  inProgressPaise: number;
  /** What may still be refunded: payment − processed − in progress. */
  refundablePaise: number;
};

export function summarizePaymentRefunds(
  paymentPaise: number,
  refunds: readonly RefundLike[],
): PaymentRefundSummary {
  let refundedPaise = 0;
  let inProgressPaise = 0;
  for (const refund of refunds) {
    if (refund.status === "processed") refundedPaise += refund.amountPaise;
    else if (refund.status === "initiated") inProgressPaise += refund.amountPaise;
  }
  return {
    paymentPaise,
    refundedPaise,
    inProgressPaise,
    refundablePaise: Math.max(0, paymentPaise - refundedPaise - inProgressPaise),
  };
}

export type PaymentRefundState = "none" | "partially_refunded" | "fully_refunded";

export function paymentRefundState(summary: PaymentRefundSummary): PaymentRefundState {
  if (summary.refundedPaise <= 0) return "none";
  return summary.refundedPaise >= summary.paymentPaise
    ? "fully_refunded"
    : "partially_refunded";
}

/**
 * Display-only label for a payment. The stored status is never changed by
 * a refund; a paid payment with processed refunds reads "Paid — …".
 */
export function paymentDisplayStatus(
  paymentStatus: string,
  paymentStatusLabel: string,
  summary: PaymentRefundSummary | null,
): string {
  if (paymentStatus !== "paid" || !summary) return paymentStatusLabel;
  const state = paymentRefundState(summary);
  if (state === "fully_refunded") return "Paid — Fully Refunded";
  if (state === "partially_refunded") return "Paid — Partially Refunded";
  return paymentStatusLabel;
}

/** Only a paid payment with refundable capacity left can be refunded. */
export function canRefund(paymentStatus: string, summary: PaymentRefundSummary): boolean {
  return paymentStatus === "paid" && summary.refundablePaise > 0;
}

/**
 * The financial consequence an Admin sees before confirming: a processed
 * refund raises the enrollment's outstanding by exactly its amount
 * (D8 option A). For a Razorpay refund this happens only once Razorpay
 * confirms it.
 */
export function outstandingAfterRefund(
  outstandingPaise: number,
  refundPaise: number,
): number {
  return outstandingPaise + Math.max(0, refundPaise);
}
