import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocks only createSupabaseServerClient (the I/O boundary) with a chainable
 * builder that records every call, so lib/data/payments.ts's real query
 * construction runs. The builder has read methods plus `rpc` only — there
 * is no insert/update/delete on it, so any attempt to write `payments`
 * directly (instead of through record_offline_payment) would throw and
 * surface as ok:false.
 *
 * The reconciliation block at the end is the Phase 14 / Phase 19
 * regression proof: the row a recorded offline payment produces (status
 * paid, total_amount = amount) moves getEnrollmentFinancialSummary by
 * exactly that amount, and the Phase 19 financial report row for the same
 * enrollment reports the same four figures.
 */

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  findEnrollmentIdByCode,
  getPaymentDetail,
  getPaymentLedgerPage,
  recordOfflinePayment,
} from "@/lib/data/payments";
import { getEnrollmentFinancialSummary } from "@/lib/data/enrollments";
import { getReportPage } from "@/lib/data/reports";
import { parseReportFilters } from "@/lib/domain/reports";
import { parsePaymentLedgerFilters } from "@/lib/domain/payments";

type Call = { method: string; args: unknown[] };
type QueryResult = { data?: unknown; error?: unknown; count?: number | null };
type Query = { table: string; calls: Call[] };

const READ_METHODS = [
  "select",
  "eq",
  "in",
  "or",
  "gte",
  "lte",
  "lt",
  "order",
  "limit",
  "range",
  "maybeSingle",
];

function makeClient(results: QueryResult[], rpcResult?: QueryResult) {
  const queries: Query[] = [];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    from(table: string) {
      const record: Query = { table, calls: [] };
      queries.push(record);
      const result = results.shift() ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of READ_METHODS) {
        builder[method] = (...args: unknown[]) => {
          record.calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (value: QueryResult) => unknown) =>
        resolve({ error: null, ...result });
      return builder;
    },
    rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ error: null, ...(rpcResult ?? { data: [] }) });
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return { queries, rpcCalls };
}

function callsOf(query: Query, method: string) {
  return query.calls.filter((c) => c.method === method).map((c) => c.args);
}

const PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENROLLMENT_ID = "11111111-2222-4333-8444-555555555555";

const ledgerRow = {
  id: PAYMENT_ID,
  payment_code: "PAY-000042",
  paid_at: "2026-10-08T18:30:00+00:00",
  created_at: "2026-10-09T05:00:00+00:00",
  total_amount: 2500.5,
  method: "upi",
  payment_type: "partial",
  status: "paid",
  internal_reference: "UTR-77",
  enrollment_id: ENROLLMENT_ID,
  student_id: "s1",
  enrollment: {
    enrollment_code: "ENR-000012",
    program: { name: "QA Program" },
    batch: { name: "Weekend Batch" },
  },
  student: { student_code: "10042", first_name: "Asha", last_name: "Rao" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getPaymentLedgerPage", () => {
  it("reads payments with minimal columns, newest payment date first, paged", async () => {
    const { queries } = makeClient([{ data: [ledgerRow], count: 26 }]);
    const result = await getPaymentLedgerPage(parsePaymentLedgerFilters({ page: "2" }));

    expect(result).toEqual({
      ok: true,
      data: {
        total: 26,
        page: 2,
        pageSize: 25,
        rows: [
          {
            id: PAYMENT_ID,
            paymentCode: "PAY-000042",
            paidAt: "2026-10-08T18:30:00+00:00",
            createdAt: "2026-10-09T05:00:00+00:00",
            amountPaise: 250050,
            method: "upi",
            paymentType: "partial",
            status: "paid",
            reference: "UTR-77",
            enrollmentId: ENROLLMENT_ID,
            enrollmentCode: "ENR-000012",
            studentId: "s1",
            studentCode: "10042",
            studentName: "Asha Rao",
            programName: "QA Program",
            batchName: "Weekend Batch",
          },
        ],
      },
    });

    const [q] = queries;
    expect(q.table).toBe("payments");
    const [select] = callsOf(q, "select")[0] as [string];
    expect(select).not.toMatch(/razorpay|created_by|auth_user|notes/);
    expect(callsOf(q, "order")).toEqual([
      ["paid_at", { ascending: false, nullsFirst: false }],
      ["created_at", { ascending: false }],
      ["id", { ascending: true }],
    ]);
    expect(callsOf(q, "range")).toEqual([[25, 49]]);
  });

  it("filters method, status and the Asia/Kolkata payment-date range server-side", async () => {
    const { queries } = makeClient([{ data: [], count: 0 }]);
    await getPaymentLedgerPage(
      parsePaymentLedgerFilters({
        method: "cash",
        status: "paid",
        from: "2026-10-01",
        to: "2026-10-09",
      }),
    );
    const [q] = queries;
    expect(callsOf(q, "eq")).toEqual([
      ["method", "cash"],
      ["status", "paid"],
    ]);
    expect(callsOf(q, "gte")).toEqual([["paid_at", "2026-09-30T18:30:00.000Z"]]);
    expect(callsOf(q, "lt")).toEqual([["paid_at", "2026-10-09T18:30:00.000Z"]]);
  });

  it("searches payment code, reference, student and enrollment code", async () => {
    const { queries } = makeClient([
      { data: [{ id: "s1" }, { id: "s2" }] },
      { data: [{ id: "e9" }] },
      { data: [], count: 0 },
    ]);
    await getPaymentLedgerPage(parsePaymentLedgerFilters({ q: "000012" }));
    const [students, enrollments, payments] = queries;
    expect(students.table).toBe("students");
    expect(callsOf(students, "or")).toEqual([
      ["student_code.ilike.%000012%,first_name.ilike.%000012%,last_name.ilike.%000012%"],
    ]);
    expect(enrollments.table).toBe("enrollments");
    expect(callsOf(enrollments, "or")).toEqual([["enrollment_code.ilike.%000012%"]]);
    expect(callsOf(payments, "or")).toEqual([
      [
        "payment_code.ilike.%000012%,internal_reference.ilike.%000012%,student_id.in.(s1,s2),enrollment_id.in.(e9)",
      ],
    ]);
  });

  it("refuses an over-broad search instead of truncating it", async () => {
    makeClient([
      { data: Array.from({ length: 201 }, (_, i) => ({ id: `s${i}` })) },
      { data: [] },
    ]);
    const result = await getPaymentLedgerPage(parsePaymentLedgerFilters({ q: "a" }));
    expect(result).toEqual({
      ok: false,
      error: "The search matches more than 200 students. Refine the search.",
    });
  });

  it("returns a generic error on a query failure", async () => {
    makeClient([{ data: null, error: { message: "boom" } }]);
    const result = await getPaymentLedgerPage(parsePaymentLedgerFilters({}));
    expect(result).toEqual({ ok: false, error: "Could not load payments." });
  });
});

describe("getPaymentDetail", () => {
  it("adds tax, notes and the recorder's name when visible", async () => {
    makeClient([
      {
        data: {
          ...ledgerRow,
          tax_amount: "0.00",
          notes: "Paid at counter",
          created_by: "admin-row-1",
          recorder: { first_name: "Meera", last_name: "Iyer" },
        },
      },
    ]);
    const result = await getPaymentDetail(PAYMENT_ID);
    expect(result.ok && result.data).toMatchObject({
      paymentCode: "PAY-000042",
      amountPaise: 250050,
      taxAmountPaise: 0,
      notes: "Paid at counter",
      recordedByAdmin: true,
      recordedByName: "Meera Iyer",
    });
    expect(result.ok && "createdBy" in result.data).toBe(false);
  });

  it("keeps the recorder hidden when RLS does not expose that admin row", async () => {
    makeClient([
      {
        data: {
          ...ledgerRow,
          tax_amount: 0,
          notes: null,
          created_by: "admin-row-2",
          recorder: null,
        },
      },
    ]);
    const result = await getPaymentDetail(PAYMENT_ID);
    expect(result.ok && result.data).toMatchObject({
      recordedByAdmin: true,
      recordedByName: null,
    });
  });

  it("reports a missing payment", async () => {
    makeClient([{ data: null }]);
    expect(await getPaymentDetail(PAYMENT_ID)).toEqual({
      ok: false,
      error: "Payment not found.",
    });
  });
});

describe("findEnrollmentIdByCode", () => {
  it("looks the code up exactly, uppercased", async () => {
    const { queries } = makeClient([{ data: { id: ENROLLMENT_ID } }]);
    expect(await findEnrollmentIdByCode(" enr-000012 ")).toEqual({
      ok: true,
      data: ENROLLMENT_ID,
    });
    expect(callsOf(queries[0], "eq")).toEqual([["enrollment_code", "ENR-000012"]]);
  });

  it("never queries for an implausible code", async () => {
    const { queries } = makeClient([]);
    expect(await findEnrollmentIdByCode("ENR,1")).toEqual({ ok: true, data: null });
    expect(queries).toHaveLength(0);
  });
});

describe("recordOfflinePayment", () => {
  const input = {
    paymentId: PAYMENT_ID,
    enrollmentId: ENROLLMENT_ID,
    amount: "2500.50",
    method: "upi" as const,
    paymentType: "partial" as const,
    paidOn: "2026-10-09",
    reference: "UTR-77",
    notes: null,
  };

  it("calls the one DB write path with the exact decimal amount and no derived fields", async () => {
    const { queries, rpcCalls } = makeClient([], {
      data: [
        {
          recorded_payment_id: PAYMENT_ID,
          recorded_payment_code: "PAY-000043",
          already_recorded: false,
        },
      ],
    });
    const result = await recordOfflinePayment(input);
    expect(result).toEqual({
      ok: true,
      data: { id: PAYMENT_ID, paymentCode: "PAY-000043", alreadyRecorded: false },
    });
    expect(queries).toHaveLength(0);
    expect(rpcCalls).toEqual([
      {
        fn: "record_offline_payment",
        args: {
          p_payment_id: PAYMENT_ID,
          p_enrollment_id: ENROLLMENT_ID,
          p_amount: "2500.50",
          p_method: "upi",
          p_payment_type: "partial",
          p_paid_on: "2026-10-09",
          p_reference: "UTR-77",
          p_notes: null,
        },
      },
    ]);
  });

  it("reports an idempotent resubmission", async () => {
    makeClient([], {
      data: [
        {
          recorded_payment_id: PAYMENT_ID,
          recorded_payment_code: "PAY-000043",
          already_recorded: true,
        },
      ],
    });
    const result = await recordOfflinePayment(input);
    expect(result.ok && result.data.alreadyRecorded).toBe(true);
  });

  it.each([
    [
      "P2001",
      "Amount exceeds the outstanding balance of 800.00",
      "Amount exceeds the outstanding balance of 800.00.",
    ],
    [
      "P2002",
      "Offline payments can only be recorded against a confirmed enrollment (enrolled, active, on hold or completed)",
      "Offline payments can only be recorded against a confirmed enrollment (enrolled, active, on hold or completed).",
    ],
    [
      "P2003",
      "This payment form was already used for a different payment",
      "This payment form was already used for a different payment.",
    ],
    [
      "22023",
      "Payment date is required and cannot be in the future",
      "Payment date is required and cannot be in the future.",
    ],
    ["P2004", "Enrollment not found", "Enrollment not found."],
    [
      "42501",
      "Only Admin/Super Admin may record an offline payment",
      "You are not authorized to record payments.",
    ],
    ["XX000", "internal detail", "The payment could not be recorded."],
  ])("maps SQLSTATE %s to an Admin-facing message", async (code, message, expected) => {
    makeClient([], { data: null, error: { code, message } });
    expect(await recordOfflinePayment(input)).toEqual({ ok: false, error: expected });
  });
});

// ---------------------------------------------------------------------------
// Phase 14 / Phase 19 regression: a recorded offline payment participates
// in financial truth exactly, with no formula change.

describe("reconciliation after an offline payment is recorded", () => {
  const PAYABLE = "50000.00";
  const existingPaid = [{ id: "p1", enrollment_id: "e1", total_amount: "20000.00" }];
  const refunds = [{ id: "r1", amount: "1000.25", payment: { enrollment_id: "e1" } }];
  // Exactly the row record_offline_payment stores for ₹2,500.75:
  // status 'paid', tax 0, total_amount = amount.
  const offlinePayment = { id: "p-new", enrollment_id: "e1", total_amount: "2500.75" };

  async function summary(paidRows: typeof existingPaid) {
    makeClient([{ data: paidRows }, { data: refunds }]);
    const result = await getEnrollmentFinancialSummary("e1", PAYABLE);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }

  it("moves the Phase 14 summary by exactly the payment, and the Phase 19 financial report agrees", async () => {
    const before = await summary(existingPaid);
    const after = await summary([...existingPaid, offlinePayment]);

    expect(after.totalPaidPaise - before.totalPaidPaise).toBe(250075);
    expect(before.outstandingPaise - after.outstandingPaise).toBe(250075);
    expect(after.totalPayablePaise).toBe(before.totalPayablePaise);
    expect(after.totalRefundedPaise).toBe(before.totalRefundedPaise);
    // 50000.00 - (20000.00 + 2500.75) + 1000.25 = 28499.50
    expect(after.outstandingPaise).toBe(2849950);

    makeClient([
      {
        data: [
          {
            id: "e1",
            enrollment_code: "ENR-000012",
            enrollment_date: "2026-10-01",
            enrollment_status: "active",
            total_payable: PAYABLE,
            student_code: "10042",
            student_first_name: "Asha",
            student_last_name: "Rao",
            program_name: "QA Program",
            batch_name: "Weekend Batch",
          },
        ],
        count: 1,
      },
      { data: [...existingPaid, offlinePayment] },
      { data: refunds },
    ]);
    const report = await getReportPage("financial", parseReportFilters("financial", {}));
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.data.rows[0]).toMatchObject(after);
  });
});
