/**
 * Phase 21A (Receipts & Payment Documents) — pure rules, no I/O.
 *
 * The database is the authority (20260101000037_receipts_issuance.sql):
 * issue_receipt() mints the number from the one global, never-resetting
 * receipt_number_seq (DECISIONS_NEEDED.md D7), refuses anything but a
 * `paid` payment and is idempotent per payment. This module only decides
 * what the UI may offer and maps trusted database rows to the fields a
 * receipt document prints.
 *
 * A receipt prints the canonical ledger row as it is: amount, tax and
 * total come from the payment itself (tax is never recalculated here —
 * FR-141 keeps tax off, so tax_amount is 0 and no tax line is printed).
 * It never carries auth ids, internal uuids, storage paths, Razorpay order
 * ids, signatures, webhook data or card/bank details.
 */

import { formatDecimalAsINR } from "@/lib/domain/money";
import { paiseToDecimalString } from "@/lib/domain/reports";
import { paymentMethodLabel } from "@/lib/domain/payments";

/** The only payment status that qualifies for a receipt (FR-94). */
export const RECEIPT_ELIGIBLE_STATUS = "paid";

export function isReceiptEligible(paymentStatus: string): boolean {
  return paymentStatus === RECEIPT_ELIGIBLE_STATUS;
}

/**
 * Lifecycle of one payment's receipt as shown to a viewer:
 *  - not_eligible: the payment is not paid (pending / held / failed / …);
 *  - not_issued:   paid, but no receipt row yet (issuance failed or the
 *                  payment predates Phase 21A) — retryable;
 *  - pdf_pending:  number issued, PDF not yet generated — retryable on the
 *                  same number and path;
 *  - ready:        number issued and PDF stored.
 */
export type ReceiptState = "not_eligible" | "not_issued" | "pdf_pending" | "ready";

export function resolveReceiptState(input: {
  paymentStatus: string;
  receipt: { pdfGeneratedAt: string | null } | null;
}): ReceiptState {
  if (input.receipt) return input.receipt.pdfGeneratedAt ? "ready" : "pdf_pending";
  return isReceiptEligible(input.paymentStatus) ? "not_issued" : "not_eligible";
}

/** A paid payment can always be (re)tried: issuance is idempotent. */
export function canDownloadReceipt(paymentStatus: string): boolean {
  return isReceiptEligible(paymentStatus);
}

/** Same-origin route that streams the stored PDF to an authorized viewer. */
export function receiptDownloadHref(paymentId: string): string {
  return `/api/payments/${paymentId}/receipt`;
}

/** Download file name — the receipt number with filename-unsafe characters replaced. */
export function receiptFileName(receiptNumber: string): string {
  return `${receiptNumber.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
}

// ---------------------------------------------------------------------------
// Document fields

const IST_DOCUMENT_DATE = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** "2026-10-12T05:00:00Z" -> "12 Oct 2026" (Asia/Kolkata calendar day). */
export function formatDocumentDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : IST_DOCUMENT_DATE.format(date);
}

/**
 * Exact amount for a PDF: "INR 1,00,000.50". The ₹ glyph is not in the
 * PDF standard fonts, so the ISO currency code is printed instead.
 */
export function formatDocumentAmount(paise: number): string {
  return formatDecimalAsINR(paiseToDecimalString(paise)).replace("₹", "INR ");
}

export type ReceiptSourceRow = {
  receiptNumber: string;
  issuedAt: string;
  payment: {
    paymentCode: string;
    paidAt: string | null;
    method: string;
    amountPaise: number;
    taxAmountPaise: number;
    totalPaise: number;
    internalReference: string | null;
    providerPaymentId: string | null;
  };
  student: { studentCode: string; firstName: string; lastName: string };
  enrollment: { enrollmentCode: string; programName: string; batchName: string | null };
  company: {
    legalName: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    gstin: string | null;
    taxLabel: string | null;
  };
};

export type ReceiptDocument = {
  receiptNumber: string;
  receiptDate: string;
  company: {
    legalName: string;
    addressLines: string[];
    contactLine: string | null;
    gstin: string | null;
  };
  receivedFrom: Array<[string, string]>;
  paymentDetails: Array<[string, string]>;
  amounts: Array<[string, string]>;
  totalLabel: string;
  totalAmount: string;
  currency: "INR";
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildReceiptDocument(source: ReceiptSourceRow): ReceiptDocument {
  const { payment, student, enrollment, company } = source;
  const online = payment.method === "razorpay";

  const paymentDetails: Array<[string, string]> = [
    ["Payment ID", payment.paymentCode],
    ["Payment date", formatDocumentDate(payment.paidAt)],
    ["Payment source", online ? "Online (Razorpay)" : "Offline"],
    ["Payment method", online ? "Razorpay" : paymentMethodLabel(payment.method)],
  ];
  const providerPaymentId = clean(payment.providerPaymentId);
  const reference = clean(payment.internalReference);
  if (online && providerPaymentId) {
    paymentDetails.push(["Razorpay payment ID", providerPaymentId]);
  } else if (!online && reference) {
    paymentDetails.push(["Reference", reference]);
  }

  // Tax is printed only when the ledger row itself carries tax (never
  // recalculated); with tax disabled the receipt shows the amount alone.
  const amounts: Array<[string, string]> = [];
  if (payment.taxAmountPaise > 0) {
    amounts.push(["Amount", formatDocumentAmount(payment.amountPaise)]);
    amounts.push([
      clean(company.taxLabel) ?? "Tax",
      formatDocumentAmount(payment.taxAmountPaise),
    ]);
  }

  const contact = [clean(company.phone), clean(company.email)].filter(
    (part): part is string => part !== null,
  );

  return {
    receiptNumber: source.receiptNumber,
    receiptDate: formatDocumentDate(source.issuedAt),
    company: {
      legalName: company.legalName,
      addressLines: (clean(company.address) ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      contactLine: contact.length > 0 ? contact.join(" · ") : null,
      gstin: clean(company.gstin),
    },
    receivedFrom: [
      ["Student", `${student.firstName} ${student.lastName}`.trim()],
      ["Student ID", student.studentCode],
      ["Enrollment", enrollment.enrollmentCode],
      ["Program", enrollment.programName],
      ["Batch", enrollment.batchName ?? "—"],
    ],
    paymentDetails,
    amounts,
    totalLabel: "Amount received",
    totalAmount: formatDocumentAmount(payment.totalPaise),
    currency: "INR",
  };
}
