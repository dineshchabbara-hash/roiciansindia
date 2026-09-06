import { sumPaise } from "@/lib/domain/money";

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
