/**
 * Phase 20A (Offline Payments Ledger) — pure domain rules, no I/O.
 *
 * Every value set here mirrors what the database itself enforces
 * (20260101000035_offline_payments_ledger.sql's record_offline_payment and
 * the payments CHECK constraints from 20260101000007). The database is the
 * authority; these exist so the form and ledger offer exactly the values
 * the database will accept and can explain a rejection before a round trip.
 *
 * Business rules confirmed at the Phase 20A checkpoint:
 *  - offline methods are BR-6's cash / UPI / bank transfer / cheque only —
 *    `razorpay` is the Phase 20B online flow and `other` is not an offline
 *    method BR-6 names;
 *  - payments are enrollment-level only — the `installment` payment type
 *    (which implies installment allocation) is held back until a later
 *    phase defines how a payment updates installments.amount_paid_cache;
 *  - only a confirmed enrollment (the Phase 14 dashboard's
 *    CONFIRMED_ENROLLMENT_STATUSES) can receive a payment;
 *  - an amount above the current outstanding balance is rejected;
 *  - the Admin enters the date the money was received, today or earlier
 *    on the Asia/Kolkata calendar.
 */

import { CONFIRMED_ENROLLMENT_STATUSES } from "@/lib/domain/dashboard-metrics";
import type { EnrollmentStatus } from "@/lib/domain/enrollments";
import { isIsoDate, sanitizeReportSearch } from "@/lib/domain/reports";

export const PAYMENT_METHODS = [
  "razorpay",
  "cash",
  "bank_transfer",
  "upi",
  "cheque",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  razorpay: "Razorpay (online)",
  cash: "Cash",
  bank_transfer: "Bank transfer",
  upi: "UPI",
  cheque: "Cheque",
  other: "Other",
};

export const OFFLINE_PAYMENT_METHODS = [
  "cash",
  "upi",
  "bank_transfer",
  "cheque",
] as const;
export type OfflinePaymentMethod = (typeof OFFLINE_PAYMENT_METHODS)[number];

export const PAYMENT_TYPES = [
  "registration",
  "full",
  "installment",
  "partial",
  "other",
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  registration: "Registration fee",
  full: "Full payment",
  installment: "Installment",
  partial: "Partial payment",
  other: "Other",
};

export const OFFLINE_PAYMENT_TYPES = [
  "partial",
  "full",
  "registration",
  "other",
] as const;
export type OfflinePaymentType = (typeof OFFLINE_PAYMENT_TYPES)[number];

export const PAYMENT_STATUSES = [
  "pending",
  "authorized",
  "paid",
  "failed",
  "refunded",
  "partially_refunded",
  "cancelled",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pending",
  authorized: "Authorized",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
  cancelled: "Cancelled",
};

export function isOfflinePaymentMethod(value: unknown): value is OfflinePaymentMethod {
  return (
    typeof value === "string" &&
    (OFFLINE_PAYMENT_METHODS as readonly string[]).includes(value)
  );
}

export function isOfflinePaymentType(value: unknown): value is OfflinePaymentType {
  return (
    typeof value === "string" &&
    (OFFLINE_PAYMENT_TYPES as readonly string[]).includes(value)
  );
}

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method;
}

export function paymentTypeLabel(type: string): string {
  return PAYMENT_TYPE_LABELS[type as PaymentType] ?? type;
}

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status as PaymentStatus] ?? status;
}

/** Statuses that may receive an offline payment (the Phase 14 confirmed set). */
export const PAYMENT_ELIGIBLE_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] =
  CONFIRMED_ENROLLMENT_STATUSES;

export function canReceiveOfflinePayment(status: EnrollmentStatus): boolean {
  return PAYMENT_ELIGIBLE_ENROLLMENT_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Money. A submitted rupee amount is converted to integer paise by string
// manipulation only — never parseFloat — so "0.29" is exactly 29 paise.

export const RUPEE_AMOUNT_PATTERN = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

/** "1234.5" -> 123450. Returns null for anything that is not a plain amount. */
export function rupeeStringToPaise(value: string): number | null {
  const match = RUPEE_AMOUNT_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, rupees, fraction = ""] = match;
  const paise = Number(rupees) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(paise) ? paise : null;
}

// ---------------------------------------------------------------------------
// Dates. The business day is Asia/Kolkata (same convention as the reports).

const IST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

/** Today's Asia/Kolkata calendar date, YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  return IST_DAY.format(now);
}

/** A valid YYYY-MM-DD that is not after today in Asia/Kolkata. */
export function isAllowedPaymentDate(value: string, now: Date = new Date()): boolean {
  return isIsoDate(value) && value <= istToday(now);
}

// ---------------------------------------------------------------------------
// Ledger filters (URL state).

export const PAYMENT_LEDGER_PAGE_SIZE = 25;

export type PaymentLedgerFilters = {
  q: string;
  method: PaymentMethod | null;
  status: PaymentStatus | null;
  from: string | null;
  to: string | null;
  page: number;
};

export type PaymentLedgerSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parsePaymentLedgerFilters(
  raw: PaymentLedgerSearchParams,
): PaymentLedgerFilters {
  const method = first(raw.method).trim();
  const status = first(raw.status).trim();
  const from = first(raw.from).trim();
  const to = first(raw.to).trim();
  const page = first(raw.page).trim();
  return {
    q: sanitizeReportSearch(first(raw.q)),
    method: (PAYMENT_METHODS as readonly string[]).includes(method)
      ? (method as PaymentMethod)
      : null,
    status: (PAYMENT_STATUSES as readonly string[]).includes(status)
      ? (status as PaymentStatus)
      : null,
    from: isIsoDate(from) ? from : null,
    to: isIsoDate(to) ? to : null,
    page: /^\d{1,6}$/.test(page) && Number(page) > 0 ? Number(page) : 1,
  };
}

/** The filters as URL params (page omitted), for pagination links. */
export function paymentLedgerFiltersToParams(
  filters: PaymentLedgerFilters,
): Record<string, string | undefined> {
  return {
    q: filters.q || undefined,
    method: filters.method ?? undefined,
    status: filters.status ?? undefined,
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
  };
}

/** Exclusive upper bound for a payment-date range: the start of the next IST day. */
export function istDayStartUtc(isoDate: string): string {
  // Asia/Kolkata is a fixed UTC+05:30 offset (no DST).
  return new Date(`${isoDate}T00:00:00+05:30`).toISOString();
}

export function nextIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/** Normalizes a typed enrollment code for an exact lookup ("enr-000012" -> "ENR-000012"). */
export function normalizeEnrollmentCode(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{0,39}$/.test(trimmed) ? trimmed : null;
}
