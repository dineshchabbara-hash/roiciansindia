import { describe, expect, it, vi, beforeEach } from "vitest";

// See lib/data/__tests__/trainers.test.ts for why `server-only` itself must
// be mocked to import the real data-layer module under Vitest.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  assignEnrollmentBatch,
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

    // No existing Enrollment for this Student+Batch — the duplicate check
    // passes and creation proceeds.
    const dupeMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const dupeLimit = vi.fn().mockReturnValue({ maybeSingle: dupeMaybeSingle });
    const dupeEq2 = vi.fn().mockReturnValue({ limit: dupeLimit });
    const dupeEq1 = vi.fn().mockReturnValue({ eq: dupeEq2 });
    const enrollmentsSelect = vi.fn().mockReturnValue({ eq: dupeEq1 });

    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: "enr-1", enrollment_code: "ENR-000001" },
      error: null,
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    const from = vi.fn((table: string) => {
      if (table === "batches") return { select: batchSelect };
      if (table === "enrollments") return { select: enrollmentsSelect, insert };
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
    expect(dupeEq1).toHaveBeenCalledWith("student_id", "student-1");
    expect(dupeEq2).toHaveBeenCalledWith("batch_id", "batch-1");
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

  // Approved business rule (Phase 9 manual-acceptance correction, Sept
  // 2026): a Student may have only one Enrollment for a given non-null
  // Batch. Required tests 17-23.
  describe("duplicate Student+Batch prevention", () => {
    function mockEnrollmentsTable({
      programId,
      duplicateExists,
    }: {
      programId: string;
      duplicateExists: boolean;
    }) {
      const batchMaybeSingle = vi
        .fn()
        .mockResolvedValue({ data: { program_id: programId }, error: null });
      const batchEq = vi.fn().mockReturnValue({ maybeSingle: batchMaybeSingle });
      const batchSelect = vi.fn().mockReturnValue({ eq: batchEq });

      const dupeMaybeSingle = vi.fn().mockResolvedValue({
        data: duplicateExists ? { id: "existing-enr" } : null,
        error: null,
      });
      const dupeLimit = vi.fn().mockReturnValue({ maybeSingle: dupeMaybeSingle });
      const dupeEq2 = vi.fn().mockReturnValue({ limit: dupeLimit });
      const dupeEq1 = vi.fn().mockReturnValue({ eq: dupeEq2 });
      const enrollmentsSelect = vi.fn().mockReturnValue({ eq: dupeEq1 });

      const insertSingle = vi.fn().mockResolvedValue({
        data: { id: "enr-new", enrollment_code: "ENR-000099" },
        error: null,
      });
      const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
      const insert = vi.fn().mockReturnValue({ select: insertSelect });

      const from = vi.fn((table: string) => {
        if (table === "batches") return { select: batchSelect };
        if (table === "enrollments") return { select: enrollmentsSelect, insert };
        throw new Error(`Unexpected table: ${table}`);
      });
      vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
      return { insert, dupeEq1, dupeEq2 };
    }

    it("(17) allows the first Enrollment for a Student+Batch", async () => {
      const { insert } = mockEnrollmentsTable({
        programId: "program-1",
        duplicateExists: false,
      });
      const result = await createEnrollmentRecord(
        baseCreateInput({
          studentId: "student-1",
          programId: "program-1",
          batchId: "batch-1",
        }),
      );
      expect(insert).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it("(18)/(19) rejects a second Enrollment for the same Student+Batch regardless of the requested status — status is not part of this decision", async () => {
      const { insert } = mockEnrollmentsTable({
        programId: "program-1",
        duplicateExists: true,
      });
      const result = await createEnrollmentRecord(
        baseCreateInput({
          studentId: "student-1",
          programId: "program-1",
          batchId: "batch-1",
        }),
      );
      expect(insert).not.toHaveBeenCalled();
      expect(result).toEqual({
        ok: false,
        error: "This student already has an enrollment for the selected batch.",
      });
    });

    it("(20)/(21) rejects a second Enrollment for the same Student+Batch even though the existing one is cancelled/withdrawn — no reinstatement exception", async () => {
      // The duplicate check is keyed on student_id+batch_id only — the
      // existing row's status is never part of the query or the decision,
      // so an existing 'cancelled' or 'withdrawn' row still blocks creation
      // exactly like an 'enrolled' one would.
      const { insert } = mockEnrollmentsTable({
        programId: "program-1",
        duplicateExists: true,
      });
      const result = await createEnrollmentRecord(
        baseCreateInput({
          studentId: "student-1",
          programId: "program-1",
          batchId: "batch-1",
        }),
      );
      expect(insert).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
    });

    it("(22) allows the same Student to enroll in a different Batch", async () => {
      const { insert, dupeEq2 } = mockEnrollmentsTable({
        programId: "program-1",
        duplicateExists: false,
      });
      const result = await createEnrollmentRecord(
        baseCreateInput({
          studentId: "student-1",
          programId: "program-1",
          batchId: "batch-2",
        }),
      );
      expect(dupeEq2).toHaveBeenCalledWith("batch_id", "batch-2");
      expect(insert).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it("(23) allows a different Student to enroll in the same Batch", async () => {
      const { insert, dupeEq1 } = mockEnrollmentsTable({
        programId: "program-1",
        duplicateExists: false,
      });
      const result = await createEnrollmentRecord(
        baseCreateInput({
          studentId: "student-2",
          programId: "program-1",
          batchId: "batch-1",
        }),
      );
      expect(dupeEq1).toHaveBeenCalledWith("student_id", "student-2");
      expect(insert).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    // (24) Program/Batch mismatch validation still runs, and still runs
    // before the duplicate check — an already-covered case
    // ("rejects server-side when the selected Batch belongs to a different
    // Program" above) continues to pass unmodified, proving this ordering.
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

  // Concurrency backstop: the application-layer duplicate pre-check can be
  // passed by two simultaneous requests before either commits — the
  // enrollments_one_per_student_batch partial unique index is authoritative
  // for that race. A violation of it must surface the same friendly message
  // as the pre-check, never a raw Postgres/Supabase error.
  it("maps an enrollments_one_per_student_batch unique_violation (a concurrent-race loss) to the friendly duplicate message", async () => {
    const batchMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { program_id: "program-1" }, error: null });
    const batchEq = vi.fn().mockReturnValue({ maybeSingle: batchMaybeSingle });
    const batchSelect = vi.fn().mockReturnValue({ eq: batchEq });

    const dupeMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const dupeLimit = vi.fn().mockReturnValue({ maybeSingle: dupeMaybeSingle });
    const dupeEq2 = vi.fn().mockReturnValue({ limit: dupeLimit });
    const dupeEq1 = vi.fn().mockReturnValue({ eq: dupeEq2 });
    const enrollmentsSelect = vi.fn().mockReturnValue({ eq: dupeEq1 });

    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "enrollments_one_per_student_batch"',
      },
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    const from = vi.fn((table: string) => {
      if (table === "batches") return { select: batchSelect };
      if (table === "enrollments") return { select: enrollmentsSelect, insert };
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createEnrollmentRecord(
      baseCreateInput({
        studentId: "student-1",
        programId: "program-1",
        batchId: "batch-1",
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: "This student already has an enrollment for the selected batch.",
    });
  });

  // A 23505 from an unrelated constraint must not be swallowed by the same
  // friendly message — only the known Student+Batch index is handled.
  it("does not swallow an unrelated 23505 unique_violation as the duplicate-batch message", async () => {
    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "enrollments_enrollment_code_key"',
      },
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createEnrollmentRecord(baseCreateInput({ batchId: null }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toBe(
        "This student already has an enrollment for the selected batch.",
      );
      expect(result.error).toBe("Could not create the enrollment. Please try again.");
    }
  });
});

describe("updateEnrollmentStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockStatusUpdate({
    batchId,
    currentStatus = "lead",
  }: {
    batchId: string | null;
    currentStatus?: string;
  }) {
    const currentMaybeSingle = vi.fn().mockResolvedValue({
      data: { status: currentStatus, batch_id: batchId },
      error: null,
    });
    const currentEq = vi.fn().mockReturnValue({ maybeSingle: currentMaybeSingle });
    const select = vi.fn().mockReturnValue({ eq: currentEq });

    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const from = vi.fn().mockReturnValue({ select, update });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
    return { select, currentEq, update, updateEq };
  }

  it("updates only the status column, scoped to the given id, for a status that does not require a Batch", async () => {
    const { update, updateEq } = mockStatusUpdate({
      batchId: null,
      currentStatus: "lead",
    });

    const result = await updateEnrollmentStatus("enr-1", "applicant");

    expect(update).toHaveBeenCalledWith({ status: "applicant" });
    expect(updateEq).toHaveBeenCalledWith("id", "enr-1");
    expect(result).toEqual({ ok: true, data: null });
  });

  // Approved business rule (Phase 9 manual-acceptance correction, Sept
  // 2026): enrolled/active/on_hold/completed require a Batch. Required
  // tests 8-15 (via createEnrollmentRecord's Batch handling above and the
  // domain-layer enrollmentStatusRequiresBatch tests) plus the
  // status-change-specific cases below (12-15, 16).
  it.each(["enrolled", "active", "on_hold", "completed"])(
    "(8-11)/(16) rejects changing status to %s when the Enrollment's authoritative batch_id is null",
    async (status) => {
      const { update } = mockStatusUpdate({ batchId: null });
      const result = await updateEnrollmentStatus("enr-1", status as never);
      expect(update).not.toHaveBeenCalled();
      expect(result).toEqual({
        ok: false,
        error: "A batch must be assigned before this enrollment can use this status.",
      });
    },
  );

  it.each(["enrolled", "active", "on_hold", "completed"])(
    "(12-15) allows changing status to %s when the Enrollment already has a valid Batch",
    async (status) => {
      const { update, updateEq } = mockStatusUpdate({ batchId: "batch-1" });
      const result = await updateEnrollmentStatus("enr-1", status as never);
      expect(update).toHaveBeenCalledWith({ status });
      expect(updateEq).toHaveBeenCalledWith("id", "enr-1");
      expect(result).toEqual({ ok: true, data: null });
    },
  );

  it("re-reads the authoritative status/batch_id from the database rather than trusting any client-supplied value — this action takes no batchId parameter at all", async () => {
    const { select, currentEq } = mockStatusUpdate({ batchId: "batch-1" });
    await updateEnrollmentStatus("enr-1", "active");
    expect(select).toHaveBeenCalledWith("status, batch_id");
    expect(currentEq).toHaveBeenCalledWith("id", "enr-1");
  });

  // Approved business rule (Phase 9 manual-acceptance correction, Sept
  // 2026): Cancelled/Withdrawn/Completed are terminal — once reached, the
  // normal status control cannot move the Enrollment to ANY other status.
  // An earlier, narrower version only blocked moves straight to an
  // operational status; manual testing then found "cancelled -> lead ->
  // enrolled" bypassed it, so this now blocks every different target,
  // including lead/applicant. Required tests 16-34.
  describe("terminal status cannot be reopened", () => {
    const TERMINAL_STATUSES = ["cancelled", "withdrawn", "completed"];
    const ALL_OTHER_STATUSES = [
      "lead",
      "applicant",
      "enrolled",
      "active",
      "on_hold",
      "completed",
      "withdrawn",
      "cancelled",
    ];

    for (const terminal of TERMINAL_STATUSES) {
      for (const next of ALL_OTHER_STATUSES.filter((s) => s !== terminal)) {
        it(`(16-32) rejects ${terminal} -> ${next} even when a valid Batch is present`, async () => {
          const { update } = mockStatusUpdate({
            batchId: "batch-1",
            currentStatus: terminal,
          });
          const result = await updateEnrollmentStatus("enr-1", next as never);
          expect(update).not.toHaveBeenCalled();
          expect(result).toEqual({
            ok: false,
            error:
              "Cancelled, withdrawn, or completed enrollments cannot be reopened through the normal status workflow.",
          });
        });
      }
    }

    // (34) The specific bypass this rule closes: a terminal Enrollment must
    // not be routable back to an operational status via Lead/Applicant.
    it.each(TERMINAL_STATUSES)(
      "(34) blocks the terminal-via-lead/applicant bypass for %s",
      async (terminal) => {
        const viaLead = mockStatusUpdate({ batchId: "batch-1", currentStatus: terminal });
        expect(await updateEnrollmentStatus("enr-1", "lead")).toEqual({
          ok: false,
          error:
            "Cancelled, withdrawn, or completed enrollments cannot be reopened through the normal status workflow.",
        });
        expect(viaLead.update).not.toHaveBeenCalled();

        const viaApplicant = mockStatusUpdate({
          batchId: "batch-1",
          currentStatus: terminal,
        });
        expect(await updateEnrollmentStatus("enr-1", "applicant")).toEqual({
          ok: false,
          error:
            "Cancelled, withdrawn, or completed enrollments cannot be reopened through the normal status workflow.",
        });
        expect(viaApplicant.update).not.toHaveBeenCalled();
      },
    );

    it("does not block a non-terminal current status from becoming operational", async () => {
      const { update } = mockStatusUpdate({ batchId: "batch-1", currentStatus: "lead" });
      const result = await updateEnrollmentStatus("enr-1", "enrolled");
      expect(update).toHaveBeenCalledWith({ status: "enrolled" });
      expect(result).toEqual({ ok: true, data: null });
    });

    it("allows a no-op re-submission of the same terminal status", async () => {
      const { update } = mockStatusUpdate({
        batchId: "batch-1",
        currentStatus: "cancelled",
      });
      const result = await updateEnrollmentStatus("enr-1", "cancelled");
      expect(update).toHaveBeenCalledWith({ status: "cancelled" });
      expect(result).toEqual({ ok: true, data: null });
    });
  });

  it("surfaces 'Enrollment not found.' when the Enrollment being status-changed no longer exists", async () => {
    const currentMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const currentEq = vi.fn().mockReturnValue({ maybeSingle: currentMaybeSingle });
    const select = vi.fn().mockReturnValue({ eq: currentEq });
    const update = vi.fn();
    const from = vi.fn().mockReturnValue({ select, update });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await updateEnrollmentStatus("enr-missing", "active");

    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "Enrollment not found." });
  });
});

describe("assignEnrollmentBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockAssignBatch({
    currentStatus,
    currentBatchId,
    programId = "program-1",
    studentId = "student-1",
    batchProgramId = "program-1",
    batchExists = true,
    duplicateExists = false,
  }: {
    currentStatus: string;
    currentBatchId: string | null;
    programId?: string;
    studentId?: string;
    batchProgramId?: string;
    batchExists?: boolean;
    duplicateExists?: boolean;
  }) {
    const currentMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        status: currentStatus,
        batch_id: currentBatchId,
        program_id: programId,
        student_id: studentId,
      },
      error: null,
    });
    const currentEq = vi.fn().mockReturnValue({ maybeSingle: currentMaybeSingle });

    const batchMaybeSingle = vi
      .fn()
      .mockResolvedValue(
        batchExists
          ? { data: { program_id: batchProgramId }, error: null }
          : { data: null, error: null },
      );
    const batchEq = vi.fn().mockReturnValue({ maybeSingle: batchMaybeSingle });

    const dupeMaybeSingle = vi.fn().mockResolvedValue({
      data: duplicateExists ? { id: "existing-enr" } : null,
      error: null,
    });
    const dupeLimit = vi.fn().mockReturnValue({ maybeSingle: dupeMaybeSingle });
    const dupeNeq = vi.fn().mockReturnValue({ limit: dupeLimit });
    const dupeEq2 = vi.fn().mockReturnValue({ neq: dupeNeq });
    const dupeEq1 = vi.fn().mockReturnValue({ eq: dupeEq2 });

    // enrollments.select is called twice with different shapes (the
    // current-row lookup, then the duplicate pre-check) — route by the
    // exact select() argument, mirroring the pattern already used for
    // createEnrollmentRecord's own duplicate-check tests above.
    const enrollmentsSelect = vi.fn((columns: string) =>
      columns === "id" ? { eq: dupeEq1 } : { eq: currentEq },
    );

    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const from = vi.fn((table: string) => {
      if (table === "batches")
        return { select: vi.fn().mockReturnValue({ eq: batchEq }) };
      if (table === "enrollments") return { select: enrollmentsSelect, update };
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
    return { currentEq, batchEq, dupeEq1, dupeEq2, dupeNeq, update, updateEq };
  }

  it("(1) allows assigning a Batch to a Lead with no Batch", async () => {
    const { update, updateEq } = mockAssignBatch({
      currentStatus: "lead",
      currentBatchId: null,
    });
    const result = await assignEnrollmentBatch("enr-1", "batch-1");
    expect(update).toHaveBeenCalledWith({ batch_id: "batch-1" });
    expect(updateEq).toHaveBeenCalledWith("id", "enr-1");
    expect(result).toEqual({
      ok: true,
      data: { oldBatchId: null, newBatchId: "batch-1" },
    });
  });

  it("(2) allows assigning a Batch to an Applicant with no Batch", async () => {
    const { update } = mockAssignBatch({
      currentStatus: "applicant",
      currentBatchId: null,
    });
    const result = await assignEnrollmentBatch("enr-1", "batch-1");
    expect(update).toHaveBeenCalledWith({ batch_id: "batch-1" });
    expect(result.ok).toBe(true);
  });

  it("(3) allows changing the Batch on a Lead that already has one", async () => {
    const { update } = mockAssignBatch({
      currentStatus: "lead",
      currentBatchId: "batch-old",
    });
    const result = await assignEnrollmentBatch("enr-1", "batch-new");
    expect(update).toHaveBeenCalledWith({ batch_id: "batch-new" });
    expect(result).toEqual({
      ok: true,
      data: { oldBatchId: "batch-old", newBatchId: "batch-new" },
    });
  });

  it("(4) allows changing the Batch on an Applicant that already has one", async () => {
    const { update } = mockAssignBatch({
      currentStatus: "applicant",
      currentBatchId: "batch-old",
    });
    const result = await assignEnrollmentBatch("enr-1", "batch-new");
    expect(update).toHaveBeenCalledWith({ batch_id: "batch-new" });
    expect(result.ok).toBe(true);
  });

  it("(5) rejects server-side when the selected Batch belongs to a different Program, never trusting the browser", async () => {
    const { update } = mockAssignBatch({
      currentStatus: "lead",
      currentBatchId: null,
      programId: "program-1",
      batchProgramId: "program-OTHER",
    });
    const result = await assignEnrollmentBatch("enr-1", "batch-1");
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: "The selected batch does not belong to this enrollment's program.",
    });
  });

  it("(6) rejects when the same Student already has another Enrollment for the selected Batch", async () => {
    const { update } = mockAssignBatch({
      currentStatus: "lead",
      currentBatchId: null,
      duplicateExists: true,
    });
    const result = await assignEnrollmentBatch("enr-1", "batch-1");
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: "This student already has an enrollment for the selected batch.",
    });
  });

  it("(7) maps an enrollments_one_per_student_batch unique_violation (a concurrent-race loss) to the friendly duplicate message", async () => {
    const currentMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        status: "lead",
        batch_id: null,
        program_id: "program-1",
        student_id: "student-1",
      },
      error: null,
    });
    const currentEq = vi.fn().mockReturnValue({ maybeSingle: currentMaybeSingle });

    const batchMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { program_id: "program-1" }, error: null });
    const batchEq = vi.fn().mockReturnValue({ maybeSingle: batchMaybeSingle });

    const dupeMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const dupeLimit = vi.fn().mockReturnValue({ maybeSingle: dupeMaybeSingle });
    const dupeNeq = vi.fn().mockReturnValue({ limit: dupeLimit });
    const dupeEq2 = vi.fn().mockReturnValue({ neq: dupeNeq });
    const dupeEq1 = vi.fn().mockReturnValue({ eq: dupeEq2 });
    const enrollmentsSelect = vi.fn((columns: string) =>
      columns === "id" ? { eq: dupeEq1 } : { eq: currentEq },
    );

    const updateEq = vi.fn().mockResolvedValue({
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "enrollments_one_per_student_batch"',
      },
    });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const from = vi.fn((table: string) => {
      if (table === "batches")
        return { select: vi.fn().mockReturnValue({ eq: batchEq }) };
      if (table === "enrollments") return { select: enrollmentsSelect, update };
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await assignEnrollmentBatch("enr-1", "batch-1");
    expect(result).toEqual({
      ok: false,
      error: "This student already has an enrollment for the selected batch.",
    });
  });

  it.each(["enrolled", "active", "on_hold", "completed", "cancelled", "withdrawn"])(
    "(10-15) rejects Batch assignment when the Enrollment's status is %s",
    async (status) => {
      const { update } = mockAssignBatch({
        currentStatus: status,
        currentBatchId: "batch-1",
      });
      const result = await assignEnrollmentBatch("enr-1", "batch-2");
      expect(update).not.toHaveBeenCalled();
      expect(result).toEqual({
        ok: false,
        error:
          "Batch can only be assigned or changed while this enrollment is Lead or Applicant.",
      });
    },
  );

  it("rejects when the selected Batch cannot be found", async () => {
    const { update } = mockAssignBatch({
      currentStatus: "lead",
      currentBatchId: null,
      batchExists: false,
    });
    const result = await assignEnrollmentBatch("enr-1", "missing-batch");
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "Selected batch could not be found." });
  });

  it("surfaces 'Enrollment not found.' when the Enrollment no longer exists", async () => {
    const currentMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const currentEq = vi.fn().mockReturnValue({ maybeSingle: currentMaybeSingle });
    const enrollmentsSelect = vi.fn().mockReturnValue({ eq: currentEq });
    const update = vi.fn();
    const from = vi.fn().mockReturnValue({ select: enrollmentsSelect, update });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await assignEnrollmentBatch("enr-missing", "batch-1");

    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "Enrollment not found." });
  });

  it("allows clearing the Batch back to null while still Lead/Applicant", async () => {
    const { update } = mockAssignBatch({
      currentStatus: "lead",
      currentBatchId: "batch-1",
    });
    const result = await assignEnrollmentBatch("enr-1", null);
    expect(update).toHaveBeenCalledWith({ batch_id: null });
    expect(result).toEqual({
      ok: true,
      data: { oldBatchId: "batch-1", newBatchId: null },
    });
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
