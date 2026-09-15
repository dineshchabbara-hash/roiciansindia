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
//
// Current business configuration (manual-acceptance correction, Sept 2026):
// no tax is charged on Enrollments — tax_amount is always "0" (enforced in
// lib/validation/enrollments.ts, never client-supplied or auto-calculated
// from a Program/company tax rate). The formula above still holds; it just
// always resolves to agreed_fee - discount_amount + registration_fee today.

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
