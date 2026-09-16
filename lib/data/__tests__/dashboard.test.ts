import { describe, expect, it, vi, beforeEach } from "vitest";

// See lib/data/__tests__/trainers.test.ts for why `server-only` itself must
// be mocked to import the real data-layer module under Vitest.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getDashboardMetrics,
  getEnrollmentFinancialClassificationSummary,
} from "@/lib/data/dashboard";

/**
 * Manual-acceptance correction (Sept 2026): the pre-fix "Outstanding Fees"
 * figure fed EVERY enrollment (any status) into computeOutstandingFeesPaise,
 * so quoted fees for Lead/Applicant and the original fee on Cancelled/
 * Withdrawn records all counted as if they were real receivables. These
 * tests prove the corrected status-bucketed classification at the data
 * layer — where the bucketing actually happens — complementing the
 * unchanged pure-math tests in lib/domain/__tests__/dashboard-metrics.test.ts.
 */

// A thenable + chainable query-builder mock: `.select()`/`.eq()` return the
// same object (so any chain length resolves the same way), and the object
// itself is a PromiseLike resolving to `result` — mirroring how the real
// Supabase query builder can be awaited directly or after further chaining.
function makeQuery(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const builder: {
    eq: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    then: (onfulfilled: (value: typeof result) => unknown) => unknown;
  } = {
    eq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    then: (onfulfilled) => Promise.resolve(result).then(onfulfilled),
  };
  return builder;
}

// One Enrollment per approved status, each with a distinct fee, so every
// bucketing assertion can point at exactly one row.
const ENROLLMENT_ROWS = [
  { id: "enr-lead", total_payable: "10000.00", status: "lead" },
  { id: "enr-applicant", total_payable: "20000.00", status: "applicant" },
  { id: "enr-enrolled", total_payable: "50000.00", status: "enrolled" },
  { id: "enr-active", total_payable: "30000.00", status: "active" },
  { id: "enr-on-hold", total_payable: "15000.00", status: "on_hold" },
  { id: "enr-completed", total_payable: "25000.00", status: "completed" },
  { id: "enr-cancelled", total_payable: "40000.00", status: "cancelled" },
  { id: "enr-withdrawn", total_payable: "35000.00", status: "withdrawn" },
];

describe("getEnrollmentFinancialClassificationSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockQueries({
    enrollmentRows = ENROLLMENT_ROWS,
    paidPaymentRows = [] as Array<{ enrollment_id: string; total_amount: string }>,
    refundRows = [] as Array<{
      amount: string;
      payment: { enrollment_id: string } | null;
    }>,
  } = {}) {
    const enrollmentsQuery = makeQuery({ data: enrollmentRows, error: null });
    const paymentsQuery = makeQuery({ data: paidPaymentRows, error: null });
    const refundsQuery = makeQuery({ data: refundRows, error: null });

    const from = vi.fn((table: string) => {
      if (table === "enrollments") return enrollmentsQuery;
      if (table === "payments") return paymentsQuery;
      if (table === "payment_refunds") return refundsQuery;
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
    return { enrollmentsQuery, paymentsQuery, refundsQuery };
  }

  it("(1)/(2) Lead and Applicant fees count toward Pipeline Value only", async () => {
    mockQueries();
    const result = await getEnrollmentFinancialClassificationSummary();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 10000 (lead) + 20000 (applicant) = 30000
    expect(result.data.pipelineValuePaise).toBe(3000000);
    expect(result.data.pipelineEnrollmentCount).toBe(2);
  });

  it("(3) Lead/Applicant fees do not count toward Confirmed Unpaid Fees", async () => {
    mockQueries();
    const result = await getEnrollmentFinancialClassificationSummary();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 50000 (enrolled) + 30000 (active) + 15000 (on_hold) + 25000 (completed)
    // = 120000, with zero Lead/Applicant fees mixed in.
    expect(result.data.confirmedUnpaidFeesPaise).toBe(12000000);
  });

  it("(4)-(7) Enrolled/Active/On Hold/Completed fees all count toward Confirmed Unpaid Fees", async () => {
    mockQueries();
    const result = await getEnrollmentFinancialClassificationSummary();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.confirmedUnpaidFeesPaise).toBe(12000000);
    expect(result.data.confirmedEnrollmentsWithBalance).toBe(4);
  });

  it("(8)/(9) Cancelled and Withdrawn fees are excluded from both Pipeline Value and Confirmed Unpaid Fees", async () => {
    mockQueries();
    const result = await getEnrollmentFinancialClassificationSummary();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // If cancelled (40000) or withdrawn (35000) leaked into either total,
    // these would no longer match the exact sums asserted above.
    expect(result.data.pipelineValuePaise).toBe(3000000);
    expect(result.data.confirmedUnpaidFeesPaise).toBe(12000000);
  });

  it("(10) Cancelled/Withdrawn record counts and original recorded fee are accurate", async () => {
    mockQueries();
    const result = await getEnrollmentFinancialClassificationSummary();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.cancelledOrWithdrawnCount).toBe(2);
    // 40000 (cancelled) + 35000 (withdrawn) = 75000 — the original recorded
    // fee, never netted against payments/refunds.
    expect(result.data.cancelledOrWithdrawnOriginalFeePaise).toBe(7500000);
  });

  it("(11) a paid payment reduces the correct Enrollment's Confirmed Unpaid balance only", async () => {
    mockQueries({
      paidPaymentRows: [{ enrollment_id: "enr-enrolled", total_amount: "20000.00" }],
    });
    const result = await getEnrollmentFinancialClassificationSummary();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // enr-enrolled: 50000 - 20000 = 30000; others unchanged.
    // 30000 + 30000 (active) + 15000 (on_hold) + 25000 (completed) = 100000
    expect(result.data.confirmedUnpaidFeesPaise).toBe(10000000);
  });

  it("(12) a processed refund follows the existing approved balance formula (added back)", async () => {
    mockQueries({
      paidPaymentRows: [{ enrollment_id: "enr-enrolled", total_amount: "50000.00" }],
      refundRows: [{ amount: "10000.00", payment: { enrollment_id: "enr-enrolled" } }],
    });
    const result = await getEnrollmentFinancialClassificationSummary();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // enr-enrolled: 50000 - 50000 + 10000 = 10000 outstanding.
    // 10000 + 30000 + 15000 + 25000 = 80000
    expect(result.data.confirmedUnpaidFeesPaise).toBe(8000000);
  });

  it("(13) the payments/refunds queries filter to paid/processed only — failed or pending rows are never included", async () => {
    const { paymentsQuery, refundsQuery } = mockQueries();
    await getEnrollmentFinancialClassificationSummary();
    expect(paymentsQuery.eq).toHaveBeenCalledWith("status", "paid");
    expect(refundsQuery.eq).toHaveBeenCalledWith("status", "processed");
  });

  it("(14) multiple payment records against one Enrollment sum together without duplicating its fee", async () => {
    mockQueries({
      paidPaymentRows: [
        { enrollment_id: "enr-active", total_amount: "10000.00" },
        { enrollment_id: "enr-active", total_amount: "5000.00" },
      ],
    });
    const result = await getEnrollmentFinancialClassificationSummary();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // enr-active: 30000 - (10000 + 5000) = 15000; others unchanged.
    // 50000 (enrolled) + 15000 (active) + 15000 (on_hold) + 25000 (completed) = 105000
    expect(result.data.confirmedUnpaidFeesPaise).toBe(10500000);
  });

  it("(15) two Enrollments (as if belonging to one Student) remain financially isolated", async () => {
    // Same-Student isolation is structural: the balance formula is keyed
    // entirely by enrollment_id, never student_id, so a payment against one
    // Enrollment can never leak into another's balance regardless of who
    // the Student is.
    mockQueries({
      enrollmentRows: [
        { id: "enr-student-a-batch-1", total_payable: "40000.00", status: "enrolled" },
        { id: "enr-student-a-batch-2", total_payable: "60000.00", status: "enrolled" },
      ],
      paidPaymentRows: [
        { enrollment_id: "enr-student-a-batch-1", total_amount: "40000.00" },
      ],
    });
    const result = await getEnrollmentFinancialClassificationSummary();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // batch-1 fully paid (0 outstanding); batch-2 untouched (60000 outstanding).
    expect(result.data.confirmedUnpaidFeesPaise).toBe(6000000);
    expect(result.data.confirmedEnrollmentsWithBalance).toBe(1);
  });

  it("(16) preserves paise precision across the full classification", async () => {
    mockQueries({
      enrollmentRows: [
        { id: "enr-lead-precise", total_payable: "0.10", status: "lead" },
        { id: "enr-enrolled-precise", total_payable: "0.20", status: "enrolled" },
      ],
    });
    const result = await getEnrollmentFinancialClassificationSummary();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.pipelineValuePaise).toBe(10);
    expect(result.data.confirmedUnpaidFeesPaise).toBe(20);
  });

  it("returns a safe error result when the enrollments query fails", async () => {
    const from = vi.fn((table: string) => {
      if (table === "enrollments")
        return makeQuery({ data: null, error: new Error("db down") });
      return makeQuery({ data: [], error: null });
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await getEnrollmentFinancialClassificationSummary();
    expect(result.ok).toBe(false);
  });
});

describe("getDashboardMetrics — status-scoped counts and Confirmed Unpaid Fees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockQueries({
    enrollmentRows = ENROLLMENT_ROWS,
    paidPaymentRows = [] as Array<{ enrollment_id: string; total_amount: string }>,
    refundRows = [] as Array<{
      amount: string;
      payment: { enrollment_id: string } | null;
    }>,
  } = {}) {
    let studentsCalls = 0;
    const from = vi.fn((table: string) => {
      switch (table) {
        case "students":
          studentsCalls += 1;
          return makeQuery({ count: studentsCalls === 1 ? 10 : 4, error: null });
        case "trainers":
          return makeQuery({ count: 3, error: null });
        case "programs":
          return makeQuery({ count: 2, error: null });
        case "batches":
          return makeQuery({ count: 5, error: null });
        case "enrollments":
          return makeQuery({ data: enrollmentRows, error: null });
        case "payments":
          return makeQuery({ data: paidPaymentRows, error: null });
        case "payment_refunds":
          return makeQuery({ data: refundRows, error: null });
        default:
          throw new Error(`Unexpected table: ${table}`);
      }
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
    return { from };
  }

  it("(1)-(4) Confirmed Enrollments counts Enrolled, Active, On Hold and Completed records", async () => {
    // ENROLLMENT_ROWS has exactly one row per status; enr-enrolled,
    // enr-active, enr-on-hold and enr-completed are the 4 that must count.
    mockQueries();
    const result = await getDashboardMetrics();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.confirmedEnrollmentsCount).toBe(4);
  });

  it("(5)-(8) Confirmed Enrollments excludes Lead, Applicant, Cancelled and Withdrawn records", async () => {
    // If any of the 4 excluded statuses leaked in, the count below (8 total
    // rows in the fixture) would read 8 instead of the correct 4.
    mockQueries();
    const result = await getDashboardMetrics();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.confirmedEnrollmentsCount).toBe(4);
    expect(result.data.confirmedEnrollmentsCount).not.toBe(ENROLLMENT_ROWS.length);
  });

  it("(9) multiple valid Enrollments for the same Student count separately, not once per Student", async () => {
    mockQueries({
      enrollmentRows: [
        { id: "enr-student-a-batch-1", total_payable: "40000.00", status: "enrolled" },
        { id: "enr-student-a-batch-2", total_payable: "60000.00", status: "active" },
      ],
    });
    const result = await getDashboardMetrics();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both rows belong to the same Student (different Batches) in this
    // scenario, and both are qualifying statuses — the count must be 2, not
    // 1 (i.e. it counts Enrollments, never distinct Students).
    expect(result.data.confirmedEnrollmentsCount).toBe(2);
  });

  it("(10) each Enrollment is counted only once — the confirmed count derives from the same single enrollments read used for the balance, not a second/duplicated query", async () => {
    const { from } = mockQueries();
    const result = await getDashboardMetrics();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.confirmedEnrollmentsCount).toBe(4);
    // Exactly one query against `enrollments` — proves there is no separate
    // status='active' count query that could double-count or disagree.
    expect(from.mock.calls.filter(([table]) => table === "enrollments")).toHaveLength(1);
  });

  it("confirmedUnpaidFeesPaise excludes Lead/Applicant/Cancelled/Withdrawn, matching the classification summary", async () => {
    mockQueries();
    const result = await getDashboardMetrics();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same fixture and expectation as the classification summary's own
    // (3)/(8)/(9) tests above — both entry points must agree.
    expect(result.data.confirmedUnpaidFeesPaise).toBe(12000000);
  });

  it("(20) Revenue Collected remains the unfiltered sum of paid payments, unaffected by Enrollment status", async () => {
    mockQueries({
      paidPaymentRows: [
        { enrollment_id: "enr-cancelled", total_amount: "5000.00" },
        { enrollment_id: "enr-enrolled", total_amount: "20000.00" },
      ],
    });
    const result = await getDashboardMetrics();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A successful historical payment against a since-cancelled Enrollment
    // still counts toward Revenue Collected — cancellation never erases
    // payment history.
    expect(result.data.revenueCollectedPaise).toBe(2500000);
  });
});
