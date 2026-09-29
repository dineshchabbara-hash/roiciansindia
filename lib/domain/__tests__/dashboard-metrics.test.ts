import { describe, expect, it } from "vitest";
import {
  computeRevenueCollectedPaise,
  computeOutstandingFeesPaise,
  sumTotalPayablePaise,
  PIPELINE_ENROLLMENT_STATUSES,
  CONFIRMED_ENROLLMENT_STATUSES,
  CANCELLED_OR_WITHDRAWN_ENROLLMENT_STATUSES,
} from "@/lib/domain/dashboard-metrics";

// Manual-acceptance correction (Sept 2026): the centralized dashboard
// financial classification — every card that buckets Enrollments by status
// for a financial figure must use these three sets, so no card can
// independently redefine "pipeline" / "confirmed" / "cancelled or
// withdrawn" and no Enrollment can land in more than one bucket.
describe("Enrollment financial classification (dashboard)", () => {
  it("PIPELINE_ENROLLMENT_STATUSES is exactly lead + applicant", () => {
    expect([...PIPELINE_ENROLLMENT_STATUSES].sort()).toEqual(
      ["applicant", "lead"].sort(),
    );
  });

  it("CONFIRMED_ENROLLMENT_STATUSES is exactly enrolled/active/on_hold/completed", () => {
    expect([...CONFIRMED_ENROLLMENT_STATUSES].sort()).toEqual(
      ["active", "completed", "enrolled", "on_hold"].sort(),
    );
  });

  it("CANCELLED_OR_WITHDRAWN_ENROLLMENT_STATUSES is exactly cancelled + withdrawn", () => {
    expect([...CANCELLED_OR_WITHDRAWN_ENROLLMENT_STATUSES].sort()).toEqual(
      ["cancelled", "withdrawn"].sort(),
    );
  });

  // The three sets must partition the 8 approved statuses with no overlap
  // and no gap — otherwise an Enrollment could be double-counted or
  // silently excluded from every dashboard financial bucket.
  it("the three sets are mutually exclusive and together cover all 8 approved statuses", () => {
    const all = [
      ...PIPELINE_ENROLLMENT_STATUSES,
      ...CONFIRMED_ENROLLMENT_STATUSES,
      ...CANCELLED_OR_WITHDRAWN_ENROLLMENT_STATUSES,
    ];
    expect(new Set(all).size).toBe(all.length); // no duplicates across sets
    expect([...all].sort()).toEqual(
      [
        "lead",
        "applicant",
        "enrolled",
        "active",
        "on_hold",
        "completed",
        "withdrawn",
        "cancelled",
      ].sort(),
    );
  });
});

describe("sumTotalPayablePaise — raw snapshot sum, no payments/refunds involved", () => {
  it("sums the given total_payable values exactly", () => {
    expect(
      sumTotalPayablePaise([{ total_payable: "50000.50" }, { total_payable: "500.50" }]),
    ).toBe(5050100);
  });

  it("preserves paise precision for fractional rupee amounts", () => {
    // A classic float trap: 0.1 + 0.2 !== 0.3 in raw JS arithmetic.
    expect(
      sumTotalPayablePaise([{ total_payable: "0.10" }, { total_payable: "0.20" }]),
    ).toBe(30);
  });

  it("returns 0 for no enrollments", () => {
    expect(sumTotalPayablePaise([])).toBe(0);
  });
});

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
