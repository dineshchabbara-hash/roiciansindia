/**
 * Pure Payment Plan / Installment domain logic — no I/O. Mirrors
 * lib/domain/attendance.ts's pattern: only the values the schema's own CHECK
 * constraint actually allows (installments.status,
 * supabase/migrations/20260101000006_enrollment_tables.sql), matching
 * REQUIREMENTS.md FR-96's documented status set exactly (Upcoming/Due/
 * Partially Paid/Paid/Overdue/Waived). Nothing invented.
 *
 * IMPLEMENTATION_PLAN.md's Phase 14 scope calls for "status derivation ...
 * as a computed view rather than a manually maintained field where
 * possible." The stored `installments.status` column stays at its own DB
 * default ('upcoming') for every installment this phase creates, with
 * exactly one exception this phase writes explicitly: 'waived' (an Admin
 * business decision no formula can derive). Every other displayed status —
 * due/overdue/partially_paid/paid — is computed here, on read, from
 * due_date/amount/amount_paid_cache, never written back. 'partially_paid'/
 * 'paid' are structurally unreachable for a Phase-14-created installment
 * (amount_paid_cache only ever changes once real payments post, which is
 * Phase 15/16 scope — Phase 14 never writes to it), but the derivation
 * still handles them correctly for installments a later phase's payments
 * eventually mark against (amount_paid_cache > 0).
 *
 * `payment_plans.total_amount` itself is treated the same way this
 * codebase already treats `enrollments.amount_paid_cache`/
 * `outstanding_balance_cache`: a derived, server-maintained cache, never a
 * form field — lib/data/payment-plans.ts recomputes it from
 * sum(installments.amount) after every installment create/edit/remove, so
 * there is no separate "does the submitted total match the installments"
 * validation to invent (IMPLEMENTATION_PLAN.md §11's own warning against
 * guessing a total-matching formula) — the total simply IS the sum, always.
 */

export const INSTALLMENT_STATUSES = [
  "upcoming",
  "due",
  "partially_paid",
  "paid",
  "overdue",
  "waived",
] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export function isInstallmentStatus(value: unknown): value is InstallmentStatus {
  return (
    typeof value === "string" &&
    (INSTALLMENT_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * The status actually shown to Admin/Student, derived on read. `today` is
 * injected (never `new Date()` internally) so this stays a pure, testable
 * function — callers pass the server's own current date as "YYYY-MM-DD".
 */
export function deriveInstallmentDisplayStatus(installment: {
  status: InstallmentStatus;
  dueDate: string;
  amountPaise: number;
  amountPaidPaise: number;
  today: string;
}): InstallmentStatus {
  const { status, dueDate, amountPaise, amountPaidPaise, today } = installment;

  // An explicit Admin override always wins — it is the one case this
  // domain can never derive from data alone.
  if (status === "waived") return "waived";

  if (amountPaidPaise >= amountPaise && amountPaise > 0) return "paid";
  if (amountPaidPaise > 0) return "partially_paid";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "due";
  return "upcoming";
}

/**
 * Least-destructive editing rule (IMPLEMENTATION_PLAN.md §22: "if
 * unspecified, implement the least destructive behavior; prefer update over
 * delete/recreate"): an installment whose *derived* status is already
 * 'paid' is never editable — nothing in Phase 14 can produce that state
 * (see the module comment), but a future phase's payment could, and editing
 * a fully-paid installment's amount/due date after the fact would silently
 * desync it from the real payment it was paid against. Every other derived
 * status (including 'partially_paid') remains editable.
 */
export function isInstallmentEditable(displayStatus: InstallmentStatus): boolean {
  return displayStatus !== "paid";
}
