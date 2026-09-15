/**
 * Pure Enrollment-management domain logic — no I/O. Statuses are exactly
 * what the schema's own CHECK constraint allows
 * (supabase/migrations/20260101000006_enrollment_tables.sql, corrected by
 * 20260101000024_remove_registered_enrollment_status.sql) — 8 values,
 * matching REQUIREMENTS.md FR-30's documented lifecycle (Lead -> Applicant
 * -> Enrolled -> Active -> On Hold -> Completed -> Withdrawn -> Cancelled)
 * exactly. "Registered" was removed as a Phase 9 manual-acceptance
 * correction (Sept 2026) — approved business decision that Registered and
 * Enrolled are not separate stages for Roicians' workflow. No
 * transition-order enforcement is implemented: the schema has no trigger/
 * constraint restricting status changes, and no other status control in
 * this codebase (Program/Batch/Student/Trainer) enforces one either, so
 * this doesn't invent one.
 */

import { toPaise, paiseToRupees } from "@/lib/domain/money";

export const ENROLLMENT_STATUSES = [
  "lead",
  "applicant",
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

// Approved business rule (Phase 9 manual-acceptance correction, Sept 2026):
// an Enrollment may not be in an operational/student-active lifecycle state
// without a Batch. Lead/Applicant are pre-enrollment and may legitimately
// have no Batch yet. Withdrawn/Cancelled are historical/terminal states —
// deliberately excluded here: their existing batch_id (whatever it is) is
// preserved as-is, never checked or rewritten by this rule.
export const OPERATIONAL_ENROLLMENT_STATUSES = [
  "enrolled",
  "active",
  "on_hold",
  "completed",
] as const;

export function enrollmentStatusRequiresBatch(status: EnrollmentStatus): boolean {
  return (OPERATIONAL_ENROLLMENT_STATUSES as readonly string[]).includes(status);
}

// Approved business rule (Phase 9 manual-acceptance correction, Sept 2026):
// Withdrawn, Cancelled, and Completed are terminal for the normal Admin
// status control. An earlier, narrower version of this rule only blocked
// moving a terminal Enrollment straight to an operational status — manual
// testing then found that could be bypassed via "cancelled -> lead ->
// enrolled" (or withdrawn -> applicant -> enrolled), since lead/applicant
// themselves were untouched. The rule is now closed at its root: once an
// Enrollment reaches a terminal status, the normal status control cannot
// move it to ANY other status, ordinary or operational. This still does not
// invent a full transition state machine — every other currently-allowed
// transition (terminal-to-same-status included) is untouched. Reinstatement,
// if ever needed, is a separate, later, explicitly approved workflow with
// its own business rules and audit behavior — never implied by moving a
// terminal Enrollment back to Lead/Applicant.
export const TERMINAL_ENROLLMENT_STATUSES = [
  "withdrawn",
  "cancelled",
  "completed",
] as const;

export function isTerminalStatusChangeBlocked(
  currentStatus: EnrollmentStatus,
  nextStatus: EnrollmentStatus,
): boolean {
  return (
    (TERMINAL_ENROLLMENT_STATUSES as readonly string[]).includes(currentStatus) &&
    currentStatus !== nextStatus
  );
}

// Approved business rule (Phase 9 manual-acceptance correction, Sept 2026):
// a Batch may only be assigned or changed on an Enrollment while it is still
// pre-enrollment (Lead/Applicant) — see the dedicated Batch-assignment
// workflow in lib/data/enrollments.ts's assignEnrollmentBatch. Once
// operational (or terminal), the Batch is fixed through that normal
// workflow; it is never casually reassignable.
export const PRE_ENROLLMENT_STATUSES = ["lead", "applicant"] as const;

export function canAssignBatch(status: EnrollmentStatus): boolean {
  return (PRE_ENROLLMENT_STATUSES as readonly string[]).includes(status);
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
