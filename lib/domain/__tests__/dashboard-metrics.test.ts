import { describe, expect, it } from "vitest";
import {
  computeRevenueCollectedPaise,
  computeOutstandingFeesPaise,
} from "@/lib/domain/dashboard-metrics";

describe("computeRevenueCollectedPaise", () => {
  it("sums only the amounts it's given (caller already filtered to status=paid)", () => {
    expect(
      computeRevenueCollectedPaise([
        { total_amount: "20000.00" },
        { total_amount: "15000.50" },
      ]),
    ).toBe(3500050);
  });

  it("returns 0 for no payments", () => {
    expect(computeRevenueCollectedPaise([])).toBe(0);
  });
});

describe("computeOutstandingFeesPaise", () => {
  it("computes outstanding balance = payable - paid + refunded, per enrollment", () => {
    // Mirrors the exact scenario verified in the Phase 2 verification report:
    // one enrollment fully paid then half-refunded, a second untouched.
    const enrollments = [
      { id: "enr-1", total_payable: "60000.00" },
      { id: "enr-2", total_payable: "55000.00" },
    ];
    const paidPayments = [{ enrollment_id: "enr-1", total_amount: "60000.00" }];
    const processedRefunds = [{ enrollment_id: "enr-1", amount: "30000.00" }];

    const result = computeOutstandingFeesPaise(
      enrollments,
      paidPayments,
      processedRefunds,
    );

    // enr-1: 60000 - 60000 + 30000 = 30000 outstanding
    // enr-2: 55000 - 0 + 0 = 55000 outstanding
    expect(result.totalOutstandingPaise).toBe((30000 + 55000) * 100);
    expect(result.enrollmentsWithBalance).toBe(2);
  });

  it("a payment against one enrollment never reduces another enrollment's balance", () => {
    const enrollments = [
      { id: "enr-qa", total_payable: "60000.00" },
      { id: "enr-data-analytics", total_payable: "55000.00" },
    ];
    const paidPayments = [{ enrollment_id: "enr-qa", total_amount: "20000.00" }];

    const result = computeOutstandingFeesPaise(enrollments, paidPayments, []);

    // enr-data-analytics must show its FULL fee as outstanding, untouched by
    // the payment against the other enrollment (BR-5/§67).
    const daOutstanding = 55000 * 100;
    const qaOutstanding = (60000 - 20000) * 100;
    expect(result.totalOutstandingPaise).toBe(daOutstanding + qaOutstanding);
  });

  it("never reports a negative balance or counts a fully-paid enrollment", () => {
    const enrollments = [{ id: "enr-1", total_payable: "10000.00" }];
    // Overpaid / over-refunded in the other direction shouldn't happen in
    // practice, but the clamp must hold regardless.
    const paidPayments = [{ enrollment_id: "enr-1", total_amount: "10000.00" }];

    const result = computeOutstandingFeesPaise(enrollments, paidPayments, []);

    expect(result.totalOutstandingPaise).toBe(0);
    expect(result.enrollmentsWithBalance).toBe(0);
  });

  it("returns zero totals when there are no enrollments", () => {
    const result = computeOutstandingFeesPaise([], [], []);
    expect(result.totalOutstandingPaise).toBe(0);
    expect(result.enrollmentsWithBalance).toBe(0);
  });
});
