/**
 * Pure Enrollment-management domain logic — no I/O. Statuses are exactly
 * what the schema's own CHECK constraint allows
 * (supabase/migrations/20260101000006_enrollment_tables.sql) — 9 values,
 * matching REQUIREMENTS.md FR-30's documented lifecycle (Lead -> Applicant
 * -> Registered -> Enrolled -> Active -> On Hold -> Completed -> Withdrawn
 * -> Cancelled) exactly. No transition-order enforcement is implemented:
 * the schema has no trigger/constraint restricting status changes, and no
 * other status control in this codebase (Program/Batch/Student/Trainer)
 * enforces one either, so this doesn't invent one.
 */

import { toPaise, paiseToRupees } from "@/lib/domain/money";

export const ENROLLMENT_STATUSES = [
  "lead",
  "applicant",
  "registered",
  "enrolled",
  "active",
  "on_hold",
  "completed",
  "withdrawn",
  "cancelled",
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export function isEnrollmentStatus(value: unknown): value is EnrollmentStatus {
  return (
    typeof value === "string" &&
    (ENROLLMENT_STATUSES as readonly string[]).includes(value)
  );
}

// enrollments.payment_plan_type CHECK: ('full', 'installments'). Stored as a
// simple reference field only — Phase 9 does not build the installment
// schedule/engine behind it (Phase 14 — Payment Plans & Financial Engine).
export const PAYMENT_PLAN_TYPES = ["full", "installments"] as const;
export type PaymentPlanType = (typeof PAYMENT_PLAN_TYPES)[number];

export function isPaymentPlanType(value: unknown): value is PaymentPlanType {
  return (
    typeof value === "string" && (PAYMENT_PLAN_TYPES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Commercial terms — approved formula (DATABASE_SCHEMA.md §4/§9):
//   total_payable = agreed_fee - discount_amount + registration_fee + tax_amount
// Computed here, authoritatively, from the Enrollment's own snapshot fields
// — never accepted as a client-supplied value. Decimal-safe: works in
// integer paise via lib/domain/money.ts (never JS float arithmetic),
// matching every other financial computation in this codebase
// (lib/domain/dashboard-metrics.ts).

export function computeTotalPayable(input: {
  agreedFee: string;
  discountAmount: string;
  registrationFee: string;
  taxAmount: string;
}): number {
  const totalPaise =
    toPaise(input.agreedFee) -
    toPaise(input.discountAmount) +
    toPaise(input.registrationFee) +
    toPaise(input.taxAmount);
  return paiseToRupees(totalPaise);
}

/**
 * The tax rate actually in effect for a Program at Enrollment-creation time:
 * the Program's own tax_rate_percent when set, otherwise
 * company_settings.default_tax_rate_percent — preserving the exact fallback
 * documented on programs.tax_rate_percent ("null means use
 * company_settings.default_tax_rate_percent").
 */
export function effectiveTaxRatePercent(
  programTaxRatePercent: string | null,
  companyDefaultTaxRatePercent: string,
): number {
  return programTaxRatePercent !== null
    ? Number(programTaxRatePercent)
    : Number(companyDefaultTaxRatePercent);
}

/**
 * A suggested tax_amount for the create-Enrollment form only — pre-filled,
 * not locked: enrollments.tax_amount is the Enrollment's own editable
 * snapshot field (like agreed_fee/discount_amount/registration_fee), and no
 * approved formula ties it algebraically to the rate the way total_payable
 * is tied to the other four fields. Applied to (agreed fee - discount), the
 * post-discount taxable amount.
 */
export function suggestTaxAmount(input: {
  agreedFee: string;
  discountAmount: string;
  taxRatePercent: number;
}): number {
  const taxableAmountPaise = Math.max(
    0,
    toPaise(input.agreedFee) - toPaise(input.discountAmount),
  );
  const taxPaise = Math.round((taxableAmountPaise * input.taxRatePercent) / 100);
  return paiseToRupees(taxPaise);
}
