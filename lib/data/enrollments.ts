import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import { computeOutstandingFeesPaise } from "@/lib/domain/dashboard-metrics";
import { sumPaise, toPaise } from "@/lib/domain/money";
import { computeTotalPayable, type EnrollmentStatus } from "@/lib/domain/enrollments";
import type { EnrollmentCreateInput } from "@/lib/validation/enrollments";

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[enrollments data] ${message}:`, error);
  return { ok: false, error: message };
}

const PAGE_SIZE_DEFAULT = 20;

// Postgres foreign_key_violation.
const POSTGRES_FOREIGN_KEY_VIOLATION = "23503";

// ---------------------------------------------------------------------------
// List / search / filter / pagination — sourced from enrollment_summary
// (supabase/migrations/20260101000011_views.sql, hardened to
// security_invoker in 20260101000022), a single join chain over
// enrollments/students/programs/batches with no fan-out table in the chain,
// so one Enrollment always appears exactly once regardless of how many
// payments/refunds/installments exist against it — those are never joined
// in here.

export type EnrollmentListRow = {
  id: string;
  enrollmentCode: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  programId: string;
  programCode: string;
  programName: string;
  batchId: string | null;
  batchName: string | null;
  enrollmentDate: string;
  status: EnrollmentStatus;
  totalPayable: string;
};

export type EnrollmentSearchParams = {
  q?: string;
  studentId?: string;
  programId?: string;
  batchId?: string;
  status?: EnrollmentStatus;
  page?: number;
  pageSize?: number;
};

export async function searchEnrollments(params: EnrollmentSearchParams): Promise<
  DataResult<{
    enrollments: EnrollmentListRow[];
    total: number;
    page: number;
    pageSize: number;
  }>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const page = Math.max(1, params.page ?? 1);
    const pageSize = params.pageSize ?? PAGE_SIZE_DEFAULT;

    let query = supabase
      .from("enrollment_summary")
      .select(
        "id, enrollment_code, enrollment_status, enrollment_date, total_payable, student_id, student_code, student_first_name, student_last_name, program_id, program_code, program_name, batch_id, batch_name",
        { count: "exact" },
      );

    if (params.studentId) query = query.eq("student_id", params.studentId);
    if (params.programId) query = query.eq("program_id", params.programId);
    if (params.batchId) query = query.eq("batch_id", params.batchId);
    if (params.status) query = query.eq("enrollment_status", params.status);
    if (params.q && params.q.trim().length > 0) {
      query = query.ilike("enrollment_code", `%${params.q.trim()}%`);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await query
      .order("enrollment_date", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      enrollment_code: string;
      enrollment_status: EnrollmentStatus;
      enrollment_date: string;
      total_payable: string;
      student_id: string;
      student_code: string;
      student_first_name: string;
      student_last_name: string;
      program_id: string;
      program_code: string;
      program_name: string;
      batch_id: string | null;
      batch_name: string | null;
    }>;

    return {
      ok: true,
      data: {
        enrollments: rows.map((row) => ({
          id: row.id,
          enrollmentCode: row.enrollment_code,
          studentId: row.student_id,
          studentCode: row.student_code,
          studentName: `${row.student_first_name} ${row.student_last_name}`,
          programId: row.program_id,
          programCode: row.program_code,
          programName: row.program_name,
          batchId: row.batch_id,
          batchName: row.batch_name,
          enrollmentDate: row.enrollment_date,
          status: row.enrollment_status,
          totalPayable: row.total_payable,
        })),
        total: count ?? 0,
        page,
        pageSize,
      },
    };
  } catch (error) {
    return fail("Could not load the enrollment list.", error);
  }
}

// ---------------------------------------------------------------------------
// Option lists for filters/create form

export async function getStudentOptions(): Promise<
  DataResult<
    Array<{ id: string; firstName: string; lastName: string; studentCode: string }>
  >
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("students")
      .select("id, first_name, last_name, student_code")
      .order("first_name");
    if (error) throw error;
    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        studentCode: row.student_code,
      })),
    };
  } catch (error) {
    return fail("Could not load the student list.", error);
  }
}

export type ProgramPricingOption = {
  id: string;
  name: string;
  programCode: string;
  regularFee: string;
  registrationFee: string;
  taxRatePercent: string | null;
};

export async function getProgramPricingOptions(): Promise<
  DataResult<ProgramPricingOption[]>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("programs")
      .select("id, name, program_code, regular_fee, registration_fee, tax_rate_percent")
      .order("name");
    if (error) throw error;
    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        programCode: row.program_code,
        regularFee: row.regular_fee,
        registrationFee: row.registration_fee,
        taxRatePercent: row.tax_rate_percent,
      })),
    };
  } catch (error) {
    return fail("Could not load the program list.", error);
  }
}

export type BatchOption = { id: string; name: string; programId: string; status: string };

// All batches, each tagged with its own programId — the create-Enrollment
// form filters this list down to the selected Program client-side (no
// cross-field server round trip needed, same as this table's own row
// count), but the SERVER independently re-derives and checks the
// Program/Batch relationship on submit in createEnrollmentRecord below;
// this list is display convenience only, never trusted for authorization.
export async function getBatchOptionsForEnrollment(): Promise<DataResult<BatchOption[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("batches")
      .select("id, name, program_id, status")
      .order("name");
    if (error) throw error;
    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        programId: row.program_id,
        status: row.status,
      })),
    };
  } catch (error) {
    return fail("Could not load the batch list.", error);
  }
}

// ---------------------------------------------------------------------------
// Profile (core row) — queried directly from `enrollments` (Admin RLS),
// joined to student/program/batch for display names only. Unlike the list,
// the detail page needs the full commercial-terms breakdown
// (agreed_fee/discount_amount/discount_reason/registration_fee/tax_amount),
// which enrollment_summary does not expose.

export type EnrollmentProfile = {
  id: string;
  enrollmentCode: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  programId: string;
  programName: string;
  programCode: string;
  batchId: string | null;
  batchName: string | null;
  enrollmentDate: string;
  status: EnrollmentStatus;
  regularFee: string;
  agreedFee: string;
  discountAmount: string;
  discountReason: string | null;
  registrationFee: string;
  taxAmount: string;
  totalPayable: string;
  paymentPlanType: string | null;
  source: string | null;
  notes: string | null;
  createdAt: string;
};

export async function getEnrollmentProfile(
  id: string,
): Promise<DataResult<EnrollmentProfile>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("enrollments")
      .select(
        "id, enrollment_code, student_id, program_id, batch_id, enrollment_date, status, regular_fee, agreed_fee, discount_amount, discount_reason, registration_fee, tax_amount, total_payable, payment_plan_type, source, notes, created_at, student:students(first_name, last_name, student_code), program:programs(name, program_code), batch:batches(name)",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: false, error: "Enrollment not found." };

    const row = data as unknown as {
      id: string;
      enrollment_code: string;
      student_id: string;
      program_id: string;
      batch_id: string | null;
      enrollment_date: string;
      status: EnrollmentStatus;
      regular_fee: string;
      agreed_fee: string;
      discount_amount: string;
      discount_reason: string | null;
      registration_fee: string;
      tax_amount: string;
      total_payable: string;
      payment_plan_type: string | null;
      source: string | null;
      notes: string | null;
      created_at: string;
      student: { first_name: string; last_name: string; student_code: string } | null;
      program: { name: string; program_code: string } | null;
      batch: { name: string } | null;
    };

    return {
      ok: true,
      data: {
        id: row.id,
        enrollmentCode: row.enrollment_code,
        studentId: row.student_id,
        studentCode: row.student?.student_code ?? "—",
        studentName: row.student
          ? `${row.student.first_name} ${row.student.last_name}`
          : "Unknown student",
        programId: row.program_id,
        programName: row.program?.name ?? "Unknown program",
        programCode: row.program?.program_code ?? "—",
        batchId: row.batch_id,
        batchName: row.batch?.name ?? null,
        enrollmentDate: row.enrollment_date,
        status: row.status,
        regularFee: row.regular_fee,
        agreedFee: row.agreed_fee,
        discountAmount: row.discount_amount,
        discountReason: row.discount_reason,
        registrationFee: row.registration_fee,
        taxAmount: row.tax_amount,
        totalPayable: row.total_payable,
        paymentPlanType: row.payment_plan_type,
        source: row.source,
        notes: row.notes,
        createdAt: row.created_at,
      },
    };
  } catch (error) {
    return fail("Could not load the enrollment profile.", error);
  }
}

// ---------------------------------------------------------------------------
// Financial position — READ ONLY. Computed live from payments/payment_refunds
// (the approved source of truth, DATABASE_SCHEMA.md §6 — never from
// enrollments.amount_paid_cache/outstanding_balance_cache, not kept in sync
// by any code, see lib/domain/dashboard-metrics.ts's header comment),
// scoped to exactly this one enrollment_id so a payment/refund belonging to
// a different Enrollment can never affect this figure — reuses the exact
// same computeOutstandingFeesPaise formula the Admin dashboard already
// uses, just fed a single-enrollment slice.

export type EnrollmentFinancialSummary = {
  totalPayablePaise: number;
  totalPaidPaise: number;
  totalRefundedPaise: number;
  outstandingPaise: number;
};

export async function getEnrollmentFinancialSummary(
  enrollmentId: string,
  totalPayable: string,
): Promise<DataResult<EnrollmentFinancialSummary>> {
  try {
    const supabase = await createSupabaseServerClient();
    const [paidPayments, processedRefunds] = await Promise.all([
      supabase
        .from("payments")
        .select("total_amount")
        .eq("enrollment_id", enrollmentId)
        .eq("status", "paid"),
      supabase
        .from("payment_refunds")
        .select("amount, payment:payments!inner(enrollment_id)")
        .eq("status", "processed")
        .eq("payment.enrollment_id", enrollmentId),
    ]);

    if (paidPayments.error) throw paidPayments.error;
    if (processedRefunds.error) throw processedRefunds.error;

    const paidRows = (paidPayments.data ?? []).map((p) => ({
      enrollment_id: enrollmentId,
      total_amount: p.total_amount,
    }));
    const refundRows = (processedRefunds.data ?? []).map((r) => ({
      enrollment_id: enrollmentId,
      amount: r.amount as unknown as string,
    }));

    const { totalOutstandingPaise } = computeOutstandingFeesPaise(
      [{ id: enrollmentId, total_payable: totalPayable }],
      paidRows,
      refundRows,
    );

    const totalPaidPaise = sumPaise(paidRows.map((p) => p.total_amount));
    const totalRefundedPaise = sumPaise(refundRows.map((r) => r.amount));

    return {
      ok: true,
      data: {
        totalPayablePaise: toPaise(totalPayable),
        totalPaidPaise,
        totalRefundedPaise,
        outstandingPaise: totalOutstandingPaise,
      },
    };
  } catch (error) {
    return fail("Could not load the financial summary.", error);
  }
}

// ---------------------------------------------------------------------------
// Creation

export async function createEnrollmentRecord(
  input: EnrollmentCreateInput,
): Promise<DataResult<{ id: string; enrollmentCode: string }>> {
  try {
    const supabase = await createSupabaseServerClient();

    // Server-side, independent re-check: the selected Batch must actually
    // belong to the selected Program. Never trust the browser's own
    // filtering of the Batch dropdown for this — a tampered/stale form
    // submission must be rejected here regardless of what the UI showed.
    if (input.batchId) {
      const { data: batch, error: batchError } = await supabase
        .from("batches")
        .select("program_id")
        .eq("id", input.batchId)
        .maybeSingle();
      if (batchError) throw batchError;
      if (!batch) {
        return { ok: false, error: "Selected batch could not be found." };
      }
      if (batch.program_id !== input.programId) {
        return {
          ok: false,
          error: "The selected batch does not belong to the selected program.",
        };
      }
    }

    const totalPayable = computeTotalPayable({
      agreedFee: input.agreedFee,
      discountAmount: input.discountAmount,
      registrationFee: input.registrationFee,
      taxAmount: input.taxAmount,
    });

    if (totalPayable < 0) {
      return {
        ok: false,
        error:
          "The discount cannot exceed the agreed fee plus registration fee and tax — total payable cannot be negative.",
      };
    }

    const { data, error } = await supabase
      .from("enrollments")
      .insert({
        student_id: input.studentId,
        program_id: input.programId,
        batch_id: input.batchId,
        ...(input.enrollmentDate ? { enrollment_date: input.enrollmentDate } : {}),
        regular_fee: input.regularFee,
        agreed_fee: input.agreedFee,
        discount_amount: input.discountAmount,
        discount_reason: input.discountReason,
        registration_fee: input.registrationFee,
        tax_amount: input.taxAmount,
        total_payable: totalPayable.toFixed(2),
        payment_plan_type: input.paymentPlanType,
        source: input.source,
        notes: input.notes,
      })
      .select("id, enrollment_code")
      .single();

    if (error) {
      if ((error as { code?: string }).code === POSTGRES_FOREIGN_KEY_VIOLATION) {
        return {
          ok: false,
          error: "Selected student, program, or batch could not be found.",
        };
      }
      throw error;
    }

    return { ok: true, data: { id: data.id, enrollmentCode: data.enrollment_code } };
  } catch (error) {
    return fail("Could not create the enrollment. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Status change — Student/Program/Batch/commercial terms are read-only
// after creation (no update path exists for them in Phase 9 — see the
// Phase 9 report's Editability section); only the lifecycle status can
// change post-creation.

export async function updateEnrollmentStatus(
  id: string,
  status: EnrollmentStatus,
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("enrollments").update({ status }).eq("id", id);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not update the enrollment's status. Please try again.", error);
  }
}
