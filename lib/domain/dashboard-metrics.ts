import { sumPaise } from "@/lib/domain/money";
import type { EnrollmentStatus } from "@/lib/domain/enrollments";

/**
 * Pure financial computations for the Admin dashboard — no I/O, no Supabase
 * import (transitively or otherwise), so these are testable without a
 * database and safely importable from anywhere, including client bundles,
 * without tripping the `server-only` guard on lib/supabase/server.ts. The
 * actual data-fetching lives in lib/data/dashboard.ts, which calls these.
 *
 * Both sourced directly from `payments`/`payment_refunds` — the approved
 * financial source of truth (DATABASE_SCHEMA.md §6) — never from
 * `enrollments.amount_paid_cache`/`outstanding_balance_cache`, which are not
 * yet kept in sync by any domain code (Phase 9/15 work).
 */

// ---------------------------------------------------------------------------
// Centralized Admin-dashboard financial classification (Phase 9
// manual-acceptance correction, Sept 2026). Root cause of the pre-fix
// "Outstanding Fees" figure: it summed every Enrollment's balance
// regardless of status, so quoted fees for Leads/Applicants and the
// original fee on Cancelled/Withdrawn records all counted as if they were
// real receivables. Every dashboard card that buckets Enrollments by
// status for a financial figure must use these three sets below, so no
// card independently invents its own definition of "pipeline" /
// "confirmed" / "cancelled or withdrawn".
//
// These are dashboard-presentation groupings only — they do not change
// enrollments.status's own CHECK constraint, or the *different* concept of
// "terminal for the status-transition workflow"
// (TERMINAL_ENROLLMENT_STATUSES in lib/domain/enrollments.ts, which also
// includes 'completed' — completed cannot be reopened, but it IS a
// confirmed, successful Enrollment financially, so it belongs in
// CONFIRMED_ENROLLMENT_STATUSES below, not with Cancelled/Withdrawn).

// Lead/Applicant: pre-enrollment. No confirmed commercial relationship yet
// — a quoted fee here is a pipeline indicator, never a receivable.
export const PIPELINE_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = [
  "lead",
  "applicant",
];

// Enrolled/Active/On Hold/Completed: a confirmed Enrollment. Its balance
// (computeOutstandingFeesPaise, unchanged) is a real unpaid-fee figure.
export const CONFIRMED_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = [
  "enrolled",
  "active",
  "on_hold",
  "completed",
];

// Cancelled/Withdrawn only. Financially unresolved pending a future,
// separately-approved Phase 14 settlement workflow — never presented as a
// receivable, loss, refund-due, or written-off debt.
export const CANCELLED_OR_WITHDRAWN_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = [
  "cancelled",
  "withdrawn",
];

/**
 * Raw sum of Enrollments' own stored total_payable snapshots — no payments/
 * refunds involved, no balance computed. Used for the Pipeline Value and
 * Cancelled/Withdrawn "original recorded fee" figures, both of which are
 * explicitly informational amounts, never a balance owed.
 */
export function sumTotalPayablePaise(
  enrollments: Array<{ total_payable: string | number }>,
): number {
  return sumPaise(enrollments.map((e) => e.total_payable));
}

export function computeRevenueCollectedPaise(
  paidPayments: Array<{ total_amount: string | number }>,
): number {
  return sumPaise(paidPayments.map((p) => p.total_amount));
}

export function computeOutstandingFeesPaise(
  enrollments: Array<{ id: string; total_payable: string | number }>,
  paidPayments: Array<{ enrollment_id: string; total_amount: string | number }>,
  processedRefunds: Array<{ enrollment_id: string; amount: string | number }>,
): { totalOutstandingPaise: number; enrollmentsWithBalance: number } {
  const paidByEnrollment = new Map<string, number>();
  for (const p of paidPayments) {
    paidByEnrollment.set(
      p.enrollment_id,
      (paidByEnrollment.get(p.enrollment_id) ?? 0) + sumPaise([p.total_amount]),
    );
  }
  const refundedByEnrollment = new Map<string, number>();
  for (const r of processedRefunds) {
    refundedByEnrollment.set(
      r.enrollment_id,
      (refundedByEnrollment.get(r.enrollment_id) ?? 0) + sumPaise([r.amount]),
    );
  }

  let totalOutstandingPaise = 0;
  let enrollmentsWithBalance = 0;
  for (const e of enrollments) {
    const payablePaise = sumPaise([e.total_payable]);
    const paidPaise = paidByEnrollment.get(e.id) ?? 0;
    const refundedPaise = refundedByEnrollment.get(e.id) ?? 0;
    const balance = Math.max(0, payablePaise - paidPaise + refundedPaise);
    if (balance > 0) {
      totalOutstandingPaise += balance;
      enrollmentsWithBalance += 1;
    }
  }
  return { totalOutstandingPaise, enrollmentsWithBalance };
}
