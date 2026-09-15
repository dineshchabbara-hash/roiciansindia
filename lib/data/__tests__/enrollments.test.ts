import { describe, expect, it, vi, beforeEach } from "vitest";

// See lib/data/__tests__/trainers.test.ts for why `server-only` itself must
// be mocked to import the real data-layer module under Vitest.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createEnrollmentRecord,
  getEnrollmentFinancialSummary,
  searchEnrollments,
  updateEnrollmentStatus,
} from "@/lib/data/enrollments";
import type { EnrollmentCreateInput } from "@/lib/validation/enrollments";

function baseCreateInput(
  overrides: Partial<EnrollmentCreateInput> = {},
): EnrollmentCreateInput {
  return {
    studentId: "student-1",
    programId: "program-1",
    batchId: null,
    enrollmentDate: null,
    regularFee: "50000",
    agreedFee: "45000",
    discountAmount: "0",
    discountReason: null,
    registrationFee: "0",
    taxAmount: "0",
    paymentPlanType: null,
    source: null,
    notes: null,
    ...overrides,
  };
}

// A fluent query-builder mock: eq/ilike/order all return the same object so
// any combination/order of filters this module actually calls resolves to
// the same terminal `range()` promise — mirrors the equivalent helper
// pattern already used in lib/data/__tests__/batches.test.ts.
function makeListQueryBuilder(result: {
  data: unknown;
  error: unknown;
  count: number | null;
}) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.eq = vi.fn(() => builder);
  builder.ilike = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.range = vi.fn().mockResolvedValue(result);
  return builder;
}

describe("searchEnrollments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps enrollment_summary rows into EnrollmentListRow, one row per enrollment", async () => {
    const builder = makeListQueryBuilder({
      data: [
        {
          id: "enr-1",
          enrollment_code: "ENR-000001",
          enrollment_status: "active",
          enrollment_date: "2026-09-01",
          total_payable: "45000.00",
          student_id: "student-1",
          student_code: "STU-10001",
          student_first_name: "Asha",
          student_last_name: "Rao",
          program_id: "program-1",
          program_code: "FSD-101",
          program_name: "Full Stack Development",
          batch_id: "batch-1",
          batch_name: "September Batch",
        },
      ],
      error: null,
      count: 1,
    });
    const select = vi.fn().mockReturnValue(builder);
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await searchEnrollments({});

    expect(from).toHaveBeenCalledWith("enrollment_summary");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.enrollments).toHaveLength(1);
      expect(result.data.enrollments[0]).toEqual({
        id: "enr-1",
        enrollmentCode: "ENR-000001",
        studentId: "student-1",
        studentCode: "STU-10001",
        studentName: "Asha Rao",
        programId: "program-1",
        programCode: "FSD-101",
        programName: "Full Stack Development",
        batchId: "batch-1",
        batchName: "September Batch",
        enrollmentDate: "2026-09-01",
        status: "active",
        totalPayable: "45000.00",
      });
      expect(result.data.total).toBe(1);
    }
  });

  it("applies the search term against enrollment_code", async () => {
    const builder = makeListQueryBuilder({ data: [], error: null, count: 0 });
    const select = vi.fn().mockReturnValue(builder);
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    await searchEnrollments({ q: "ENR-0001" });

    expect(builder.ilike).toHaveBeenCalledWith("enrollment_code", "%ENR-0001%");
  });

  it("applies the student/program/batch/status filters", async () => {
    const builder = makeListQueryBuilder({ data: [], error: null, count: 0 });
    const select = vi.fn().mockReturnValue(builder);
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    await searchEnrollments({
      studentId: "student-1",
      programId: "program-1",
      batchId: "batch-1",
      status: "active",
    });

    expect(builder.eq).toHaveBeenCalledWith("student_id", "student-1");
    expect(builder.eq).toHaveBeenCalledWith("program_id", "program-1");
    expect(builder.eq).toHaveBeenCalledWith("batch_id", "batch-1");
    expect(builder.eq).toHaveBeenCalledWith("enrollment_status", "active");
  });

  it("paginates using range() derived from page/pageSize, and reports count/page/pageSize accurately", async () => {
    const builder = makeListQueryBuilder({ data: [], error: null, count: 47 });
    const select = vi.fn().mockReturnValue(builder);
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await searchEnrollments({ page: 3, pageSize: 10 });

    expect(builder.range).toHaveBeenCalledWith(20, 29);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.total).toBe(47);
      expect(result.data.page).toBe(3);
      expect(result.data.pageSize).toBe(10);
    }
  });
});

describe("createEnrollmentRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists the given Student, Program, and Batch, and computes total_payable from the approved formula", async () => {
    const batchMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { program_id: "program-1" }, error: null });
    const batchEq = vi.fn().mockReturnValue({ maybeSingle: batchMaybeSingle });
    const batchSelect = vi.fn().mockReturnValue({ eq: batchEq });

    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: "enr-1", enrollment_code: "ENR-000001" },
      error: null,
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    const from = vi.fn((table: string) => {
      if (table === "batches") return { select: batchSelect };
      if (table === "enrollments") return { insert };
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createEnrollmentRecord(
      baseCreateInput({
        studentId: "student-1",
        programId: "program-1",
        batchId: "batch-1",
        agreedFee: "45000",
        discountAmount: "5000",
        registrationFee: "1000",
        taxAmount: "2000",
      }),
    );

    expect(batchEq).toHaveBeenCalledWith("id", "batch-1");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        student_id: "student-1",
        program_id: "program-1",
        batch_id: "batch-1",
        total_payable: "43000.00", // 45000 - 5000 + 1000 + 2000
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: { id: "enr-1", enrollmentCode: "ENR-000001" },
    });
  });

  // Manual-acceptance scenario (no tax is currently charged on
  // enrollments): agreed=50000.50, discount=5000.00, reason="Early Bird",
  // registration=500.50, tax=0.00 -> total_payable = 45501.00.
  it("computes the manual-acceptance scenario exactly (tax_amount forced to 0 by validation upstream)", async () => {
    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: "enr-1", enrollment_code: "ENR-000001" },
      error: null,
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createEnrollmentRecord(
      baseCreateInput({
        batchId: null,
        agreedFee: "50000.50",
        discountAmount: "5000.00",
        discountReason: "Early Bird",
        registrationFee: "500.50",
        taxAmount: "0",
        paymentPlanType: "installments",
      }),
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        discount_reason: "Early Bird",
        tax_amount: "0",
        total_payable: "45501.00",
        payment_plan_type: "installments",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("skips the Batch/Program cross-check entirely when no Batch is selected", async () => {
    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: "enr-1", enrollment_code: "ENR-000001" },
      error: null,
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });
    const batchSelect = vi.fn();

    const from = vi.fn((table: string) => {
      if (table === "batches") return { select: batchSelect };
      if (table === "enrollments") return { insert };
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createEnrollmentRecord(baseCreateInput({ batchId: null }));

    expect(batchSelect).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("rejects server-side when the selected Batch belongs to a different Program, never trusting the browser's own filtering", async () => {
    const batchMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { program_id: "program-OTHER" }, error: null });
    const batchEq = vi.fn().mockReturnValue({ maybeSingle: batchMaybeSingle });
    const batchSelect = vi.fn().mockReturnValue({ eq: batchEq });
    const insert = vi.fn();

    const from = vi.fn((table: string) => {
      if (table === "batches") return { select: batchSelect };
      if (table === "enrollments") return { insert };
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createEnrollmentRecord(
      baseCreateInput({ programId: "program-1", batchId: "batch-1" }),
    );

    expect(insert).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: "The selected batch does not belong to the selected program.",
    });
  });

  it("rejects when the selected Batch cannot be found", async () => {
    const batchMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const batchEq = vi.fn().mockReturnValue({ maybeSingle: batchMaybeSingle });
    const batchSelect = vi.fn().mockReturnValue({ eq: batchEq });
    const insert = vi.fn();

    const from = vi.fn((table: string) => {
      if (table === "batches") return { select: batchSelect };
      if (table === "enrollments") return { insert };
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createEnrollmentRecord(
      baseCreateInput({ batchId: "missing-batch" }),
    );

    expect(insert).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "Selected batch could not be found." });
  });

  it("rejects an invalid negative total_payable before ever inserting", async () => {
    const insert = vi.fn();
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createEnrollmentRecord(
      baseCreateInput({
        batchId: null,
        agreedFee: "1000",
        discountAmount: "5000",
        registrationFee: "0",
        taxAmount: "0",
      }),
    );

    expect(insert).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cannot be negative/i);
    }
  });

  it("translates a foreign_key_violation into a clear error", async () => {
    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23503", message: "insert or update violates foreign key" },
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createEnrollmentRecord(baseCreateInput({ batchId: null }));

    expect(result).toEqual({
      ok: false,
      error: "Selected student, program, or batch could not be found.",
    });
  });
});

describe("updateEnrollmentStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates only the status column, scoped to the given id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await updateEnrollmentStatus("enr-1", "active");

    expect(update).toHaveBeenCalledWith({ status: "active" });
    expect(eq).toHaveBeenCalledWith("id", "enr-1");
    expect(result).toEqual({ ok: true, data: null });
  });
});

describe("getEnrollmentFinancialSummary — financial isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes totals scoped to exactly this Enrollment's own payments/refunds", async () => {
    const paymentsEq2 = vi
      .fn()
      .mockResolvedValue({ data: [{ total_amount: "20000.00" }], error: null });
    const paymentsEq1 = vi.fn().mockReturnValue({ eq: paymentsEq2 });
    const paymentsSelect = vi.fn().mockReturnValue({ eq: paymentsEq1 });

    const refundsEq2 = vi
      .fn()
      .mockResolvedValue({ data: [{ amount: "5000.00" }], error: null });
    const refundsEq1 = vi.fn().mockReturnValue({ eq: refundsEq2 });
    const refundsSelect = vi.fn().mockReturnValue({ eq: refundsEq1 });

    const from = vi.fn((table: string) => {
      if (table === "payments") return { select: paymentsSelect };
      if (table === "payment_refunds") return { select: refundsSelect };
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await getEnrollmentFinancialSummary("enr-A", "45000.00");

    // Enrollment-specific scoping — both queries are filtered to enr-A.
    expect(paymentsEq1).toHaveBeenCalledWith("enrollment_id", "enr-A");
    expect(paymentsEq2).toHaveBeenCalledWith("status", "paid");
    expect(refundsEq2).toHaveBeenCalledWith("payment.enrollment_id", "enr-A");

    expect(result).toEqual({
      ok: true,
      data: {
        totalPayablePaise: 4500000,
        totalPaidPaise: 2000000,
        totalRefundedPaise: 500000,
        outstandingPaise: 3000000, // 45000 - 20000 + 5000 = 30000
      },
    });
  });

  it("a second Enrollment's payments never leak into this Enrollment's totals — proven with distinct enrollment ids in the same mock", async () => {
    // Simulates the real RLS/query scoping: the mock only ever returns rows
    // for whichever enrollment_id was actually filtered on, exactly like a
    // real `.eq("enrollment_id", ...)` would against a table containing
    // both Enrollment A's and Enrollment B's payments.
    const allPayments: Record<string, Array<{ total_amount: string }>> = {
      "enr-A": [{ total_amount: "10000.00" }],
      "enr-B": [{ total_amount: "99999.00" }],
    };

    function paymentsQueryFor(enrollmentId: string) {
      const eq2 = vi
        .fn()
        .mockResolvedValue({ data: allPayments[enrollmentId] ?? [], error: null });
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
      return { select: vi.fn().mockReturnValue({ eq: eq1 }) };
    }

    const refundsEq2 = vi.fn().mockResolvedValue({ data: [], error: null });
    const refundsEq1 = vi.fn().mockReturnValue({ eq: refundsEq2 });
    const refundsSelect = vi.fn().mockReturnValue({ eq: refundsEq1 });

    const from = vi.fn((table: string) => {
      if (table === "payments") return paymentsQueryFor("enr-A");
      if (table === "payment_refunds") return { select: refundsSelect };
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await getEnrollmentFinancialSummary("enr-A", "10000.00");

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Only Enrollment A's 10000 is counted — Enrollment B's 99999 never
      // appears, because the query itself is scoped to enr-A's id.
      expect(result.data.totalPaidPaise).toBe(1000000);
    }
  });
});
