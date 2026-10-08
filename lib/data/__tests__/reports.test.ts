import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocks only createSupabaseServerClient (the I/O boundary) with a chainable
 * builder that records every call, so lib/data/reports.ts's real query
 * construction, ordering, filtering and engine reuse all run. The builder
 * exposes read methods only: any insert/update/delete/upsert/rpc attempt
 * would throw and surface as ok:false — every test below asserts ok:true,
 * which pins the module as read-only.
 */

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  fetchReportRange,
  getFinancialReportTotals,
  getReportPage,
  getReportsOverview,
} from "@/lib/data/reports";
import { getEnrollmentFinancialSummary } from "@/lib/data/enrollments";
import { parseReportFilters } from "@/lib/domain/reports";

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
];

function makeClient(results: QueryResult[]) {
  const queries: Query[] = [];
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
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return queries;
}

function callsOf(query: Query, method: string) {
  return query.calls.filter((c) => c.method === method).map((c) => c.args);
}

const P1 = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("student report", () => {
  it("selects only the minimal contact columns, orders deterministically, and pages", async () => {
    const queries = makeClient([
      {
        data: [
          {
            id: "s1",
            student_code: "ROI-STU-1",
            first_name: "Asha",
            last_name: "Rao",
            email: "a@example.com",
            phone: "+919876543210",
            status: "active",
            registration_date: "2026-01-02",
          },
        ],
        count: 26,
      },
      { data: [{ student_id: "s1" }, { student_id: "s1" }] },
    ]);

    const result = await getReportPage(
      "students",
      parseReportFilters("students", { page: "2" }),
    );

    expect(result).toEqual({
      ok: true,
      data: {
        total: 26,
        page: 2,
        pageSize: 25,
        rows: [
          {
            id: "s1",
            studentCode: "ROI-STU-1",
            firstName: "Asha",
            lastName: "Rao",
            email: "a@example.com",
            phone: "+919876543210",
            status: "active",
            registrationDate: "2026-01-02",
            enrollmentCount: 2,
          },
        ],
      },
    });

    const [students, enrollments] = queries;
    expect(students.table).toBe("students");
    const [selectColumns, selectOptions] = callsOf(students, "select")[0];
    expect(selectOptions).toEqual({ count: "exact" });
    expect(selectColumns).not.toMatch(
      /date_of_birth|address|auth_user_id|emergency|photo|gender|lead_id/,
    );
    expect(callsOf(students, "order")).toEqual([
      ["registration_date", { ascending: false, nullsFirst: false }],
      ["id", { ascending: true }],
    ]);
    expect(callsOf(students, "range")).toEqual([[25, 49]]);
    expect(enrollments.table).toBe("enrollments");
    expect(callsOf(enrollments, "in")).toEqual([["student_id", ["s1"]]]);
  });

  it("filters by program through an inner enrollment join (one row per student)", async () => {
    const queries = makeClient([{ data: [], count: 0 }]);
    const result = await getReportPage(
      "students",
      parseReportFilters("students", {
        programId: P1,
        status: "inactive",
        from: "2026-01-01",
        to: "2026-01-31",
        q: "asha),or(id.gt.0",
        sort: "name",
        dir: "asc",
      }),
    );
    expect(result.ok).toBe(true);
    const [students] = queries;
    expect(callsOf(students, "select")[0][0]).toMatch(/enrollments!inner\(/);
    expect(callsOf(students, "eq")).toEqual([
      ["enrollments.program_id", P1],
      ["status", "inactive"],
    ]);
    expect(callsOf(students, "gte")).toEqual([["registration_date", "2026-01-01"]]);
    expect(callsOf(students, "lte")).toEqual([["registration_date", "2026-01-31"]]);
    const orFilter = callsOf(students, "or")[0][0] as string;
    expect(orFilter).toContain("student_code.ilike.%ashaorid.gt.0%");
    expect(orFilter).not.toMatch(/[()]/);
    expect(callsOf(students, "order")).toEqual([
      ["last_name", { ascending: true, nullsFirst: false }],
      ["first_name", { ascending: true, nullsFirst: false }],
      ["id", { ascending: true }],
    ]);
  });

  it("returns an error result (never throws) when the query fails", async () => {
    makeClient([{ data: null, error: { message: "boom" } }]);
    const result = await getReportPage("students", parseReportFilters("students", {}));
    expect(result).toEqual({ ok: false, error: "Could not load the student report." });
  });
});

describe("enrollment report", () => {
  it("reads enrollment_summary with filters and an id tie-breaker", async () => {
    const queries = makeClient([
      {
        data: [
          {
            id: "e1",
            enrollment_code: "ROI-ENR-1",
            enrollment_date: "2026-01-03",
            enrollment_status: "active",
            student_code: "ROI-STU-1",
            student_first_name: "Asha",
            student_last_name: "Rao",
            program_name: "QA",
            batch_name: null,
          },
        ],
        count: 1,
      },
    ]);
    const result = await fetchReportRange(
      "enrollments",
      parseReportFilters("enrollments", { status: "active", batchId: P1 }),
      0,
      24,
    );
    expect(result.ok && result.data.rows[0]).toEqual({
      id: "e1",
      enrollmentCode: "ROI-ENR-1",
      enrollmentDate: "2026-01-03",
      status: "active",
      studentCode: "ROI-STU-1",
      studentFirstName: "Asha",
      studentLastName: "Rao",
      programName: "QA",
      batchName: null,
    });
    const [summary] = queries;
    expect(summary.table).toBe("enrollment_summary");
    expect(callsOf(summary, "select")[0][0]).not.toMatch(/cache/);
    expect(callsOf(summary, "eq")).toEqual([
      ["enrollment_status", "active"],
      ["batch_id", P1],
    ]);
    expect(callsOf(summary, "order").at(-1)).toEqual(["id", { ascending: true }]);
  });
});

describe("financial report", () => {
  const summaryRows = [
    {
      id: "e1",
      enrollment_code: "ROI-ENR-1",
      enrollment_date: "2026-01-03",
      enrollment_status: "active",
      total_payable: 50000,
      student_code: "ROI-STU-1",
      student_first_name: "Asha",
      student_last_name: "Rao",
      program_name: "QA",
      batch_name: "B1",
    },
    {
      id: "e2",
      enrollment_code: "ROI-ENR-2",
      enrollment_date: "2026-01-04",
      enrollment_status: "enrolled",
      total_payable: "1000.50",
      student_code: "ROI-STU-2",
      student_first_name: "Ravi",
      student_last_name: "K",
      program_name: "QA",
      batch_name: "B1",
    },
  ];
  const paidRows = [
    { id: "p1", enrollment_id: "e1", total_amount: "20000.00" },
    { id: "p2", enrollment_id: "e1", total_amount: 5000.5 },
    { id: "p3", enrollment_id: "e2", total_amount: "1000.50" },
  ];
  const refundRows = [{ id: "r1", amount: "1000.25", payment: { enrollment_id: "e1" } }];

  it("reuses the engine (paid / processed only) and reconciles with getEnrollmentFinancialSummary", async () => {
    const queries = makeClient([
      { data: summaryRows, count: 2 },
      { data: paidRows },
      { data: refundRows },
    ]);
    const result = await getReportPage("financial", parseReportFilters("financial", {}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [summary, payments, refunds] = queries;
    expect(summary.table).toBe("enrollment_summary");
    expect(callsOf(summary, "in")).toEqual([
      ["enrollment_status", ["enrolled", "active", "on_hold", "completed"]],
    ]);
    expect(payments.table).toBe("payments");
    expect(callsOf(payments, "eq")).toEqual([["status", "paid"]]);
    expect(callsOf(payments, "in")).toEqual([["enrollment_id", ["e1", "e2"]]]);
    expect(refunds.table).toBe("payment_refunds");
    expect(callsOf(refunds, "eq")).toEqual([["status", "processed"]]);
    expect(callsOf(refunds, "in")).toEqual([["payment.enrollment_id", ["e1", "e2"]]]);

    const [row1, row2] = result.data.rows;
    expect(row1).toMatchObject({
      totalPayablePaise: 5000000,
      totalPaidPaise: 2500050,
      totalRefundedPaise: 100025,
      outstandingPaise: 2599975,
    });
    expect(row2).toMatchObject({
      totalPayablePaise: 100050,
      totalPaidPaise: 100050,
      totalRefundedPaise: 0,
      outstandingPaise: 0,
    });

    // The authoritative per-enrollment engine, fed the same enrollment's own
    // rows, must produce exactly the same four figures.
    makeClient([
      { data: paidRows.filter((p) => p.enrollment_id === "e1") },
      { data: refundRows },
    ]);
    const authoritative = await getEnrollmentFinancialSummary("e1", "50000");
    expect(authoritative).toEqual({
      ok: true,
      data: {
        totalPayablePaise: row1.totalPayablePaise,
        totalPaidPaise: row1.totalPaidPaise,
        totalRefundedPaise: row1.totalRefundedPaise,
        outstandingPaise: row1.outstandingPaise,
      },
    });
  });

  it("applies no status restriction for the 'all' group", async () => {
    const queries = makeClient([{ data: [], count: 0 }]);
    await getReportPage("financial", parseReportFilters("financial", { group: "all" }));
    expect(callsOf(queries[0], "in")).toEqual([]);
  });

  it("totals the whole filtered set from the same per-enrollment figures", async () => {
    const queries = makeClient([
      { data: summaryRows },
      { data: paidRows },
      { data: refundRows },
    ]);
    const result = await getFinancialReportTotals(parseReportFilters("financial", {}));
    expect(result).toEqual({
      ok: true,
      data: {
        enrollmentCount: 2,
        totalPayablePaise: 5100050,
        totalPaidPaise: 2600100,
        totalRefundedPaise: 100025,
        outstandingPaise: 2599975,
      },
    });
    expect(callsOf(queries[0], "range")).toEqual([[0, 999]]);
  });
});

describe("attendance report", () => {
  it("reads the Phase 13 view verbatim and resolves names for the page", async () => {
    const queries = makeClient([
      {
        data: [
          {
            enrollment_id: "e1",
            student_id: "s1",
            batch_id: "b1",
            total_sessions: 3,
            present_count: 1,
            absent_count: 1,
            late_count: 1,
            excused_count: 0,
            attendance_percentage: 66.67,
          },
        ],
        count: 1,
      },
      { data: [{ id: "e1", enrollment_code: "ROI-ENR-1", program: { name: "QA" } }] },
      {
        data: [
          { id: "s1", student_code: "ROI-STU-1", first_name: "Asha", last_name: "Rao" },
        ],
      },
      { data: [{ id: "b1", name: "B1" }] },
    ]);
    const result = await getReportPage(
      "attendance",
      parseReportFilters("attendance", { below: "75", batchId: P1 }),
    );
    expect(result.ok && result.data.rows).toEqual([
      {
        enrollmentId: "e1",
        batchId: "b1",
        enrollmentCode: "ROI-ENR-1",
        studentCode: "ROI-STU-1",
        studentFirstName: "Asha",
        studentLastName: "Rao",
        programName: "QA",
        batchName: "B1",
        totalSessions: 3,
        presentCount: 1,
        lateCount: 1,
        absentCount: 1,
        excusedCount: 0,
        attendancePercentage: 66.67,
      },
    ]);
    const [view] = queries;
    expect(view.table).toBe("student_attendance_summary");
    expect(callsOf(view, "lt")).toEqual([["attendance_percentage", 75]]);
    expect(callsOf(view, "eq")).toEqual([["batch_id", P1]]);
    expect(callsOf(view, "order")).toEqual([
      ["attendance_percentage", { ascending: true, nullsFirst: false }],
      ["enrollment_id", { ascending: true }],
      ["batch_id", { ascending: true }],
    ]);
  });

  it("returns an empty page when the program has no batches", async () => {
    const queries = makeClient([{ data: [] }, { data: [] }]);
    const result = await getReportPage(
      "attendance",
      parseReportFilters("attendance", { programId: P1 }),
    );
    expect(result).toEqual({
      ok: true,
      data: { rows: [], total: 0, page: 1, pageSize: 25 },
    });
    expect(queries.map((q) => q.table)).toEqual([
      "student_attendance_summary",
      "batches",
    ]);
  });

  it("refuses an over-broad search instead of truncating it", async () => {
    makeClient([
      { data: [] },
      { data: Array.from({ length: 201 }, (_, i) => ({ id: `s${i}` })) },
    ]);
    const result = await getReportPage(
      "attendance",
      parseReportFilters("attendance", { q: "a" }),
    );
    expect(result).toEqual({
      ok: false,
      error: "The search matches more than 200 students. Refine the search.",
    });
  });
});

describe("certificate report", () => {
  it("never selects pdf_path and keeps status as stored", async () => {
    const queries = makeClient([
      {
        data: [
          {
            id: "c1",
            certificate_number: "ROI-CERT-1",
            status: "revoked",
            issue_date: "2026-02-01",
            completion_date: "2026-01-31",
            revoked_at: "2026-02-03T10:00:00Z",
            student: { student_code: "ROI-STU-1", first_name: "Asha", last_name: "Rao" },
            program: { name: "QA" },
            enrollment: { enrollment_code: "ROI-ENR-1" },
          },
        ],
        count: 1,
      },
    ]);
    const result = await getReportPage(
      "certificates",
      parseReportFilters("certificates", { status: "revoked" }),
    );
    expect(result.ok && result.data.rows[0].status).toBe("revoked");
    const [certs] = queries;
    expect(certs.table).toBe("certificates");
    expect(callsOf(certs, "select")[0][0]).not.toMatch(/pdf_path|signed/);
    expect(callsOf(certs, "eq")).toEqual([["status", "revoked"]]);
  });

  it("matches a search against the certificate number or resolved students", async () => {
    const queries = makeClient([{ data: [], count: 0 }, { data: [{ id: "s1" }] }]);
    await getReportPage(
      "certificates",
      parseReportFilters("certificates", { q: "asha" }),
    );
    expect(callsOf(queries[0], "or")).toEqual([
      ["certificate_number.ilike.%asha%,student_id.in.(s1)"],
    ]);
  });
});

describe("reports overview", () => {
  it("returns head counts only", async () => {
    const queries = makeClient([{ count: 10 }, { count: 7 }, { count: 3 }, { count: 1 }]);
    const result = await getReportsOverview();
    expect(result).toEqual({
      ok: true,
      data: {
        attendanceMarked: 10,
        attendancePresentOrLate: 7,
        certificatesIssued: 3,
        certificatesRevoked: 1,
      },
    });
    expect(callsOf(queries[1], "in")).toEqual([["status", ["present", "late"]]]);
    expect(callsOf(queries[2], "eq")).toEqual([["status", "issued"]]);
    expect(callsOf(queries[3], "eq")).toEqual([["status", "revoked"]]);
  });
});
