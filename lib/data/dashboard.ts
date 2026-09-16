import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sumPaise } from "@/lib/domain/money";
import {
  computeRevenueCollectedPaise,
  computeOutstandingFeesPaise,
  sumTotalPayablePaise,
  PIPELINE_ENROLLMENT_STATUSES,
  CONFIRMED_ENROLLMENT_STATUSES,
  CANCELLED_OR_WITHDRAWN_ENROLLMENT_STATUSES,
} from "@/lib/domain/dashboard-metrics";
import type { EnrollmentStatus } from "@/lib/domain/enrollments";

/**
 * Admin dashboard data-access layer. Every exported async function here is
 * the ONLY place UI components reach the database from — components never
 * import the Supabase client or write raw queries themselves
 * (ARCHITECTURE.md §4 layering; USER_ROLES_AND_PERMISSIONS.md §2 defense in
 * depth: every query below also runs behind the same RLS policies verified
 * in the Phase 3 report, since it uses the caller's own RLS-scoped session,
 * never the service-role client).
 *
 * Every function returns a DataResult rather than throwing, so a single
 * failed query degrades to one section's error state instead of crashing
 * the page (dashboard "handles database/query failures safely").
 *
 * Financial numbers are computed directly from `payments`/`payment_refunds`
 * — the approved source of truth (DATABASE_SCHEMA.md §6) — never from
 * `enrollments.amount_paid_cache`/`outstanding_balance_cache`, which are not
 * yet kept in sync by any domain code (that recompute function is Phase
 * 9/15 work). Reading the cache columns today would silently show stale
 * zeros instead of real figures.
 */

// `ok` is a literal-boolean discriminant specifically so `if (!result.ok)`
// narrows `result.data` to defined in the remaining branch — a plain
// `{data?: T; error?: string}` shape doesn't narrow reliably in strict mode
// because `error: string` also admits the falsy value `""`.
export type DataResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail<T>(context: string, error: unknown): DataResult<T> {
  // Logged server-side only; callers/UI only ever see a generic message
  // (SECURITY_PLAN.md §12 — never leak DB/provider error detail to the client).
  console.error(`[dashboard data] ${context}:`, error);
  return { ok: false, error: `Could not load ${context}.` };
}

// ---------------------------------------------------------------------------
// Metrics grid

export type DashboardMetrics = {
  totalStudents: number;
  activeStudents: number;
  totalTrainers: number;
  activePrograms: number;
  activeBatches: number;
  // Count of Enrollment records (not distinct Students) whose status is
  // one of CONFIRMED_ENROLLMENT_STATUSES (enrolled/active/on_hold/
  // completed) — a Student with two qualifying Enrollments in different
  // Batches contributes two to this count. Approved business rule, Phase 9
  // manual-acceptance amendment, Sept 2026 (supersedes the prior
  // "Enrollments in Active Status" label, which counted only the literal
  // status='active' rows and read as ambiguous).
  confirmedEnrollmentsCount: number;
  revenueCollectedPaise: number;
  // Confirmed Enrollments only (enrolled/active/on_hold/completed) — see
  // CONFIRMED_ENROLLMENT_STATUSES. Excludes Lead/Applicant (not yet a
  // confirmed commercial relationship) and Cancelled/Withdrawn (financially
  // unresolved, tracked separately — see
  // getEnrollmentFinancialClassificationSummary below).
  confirmedUnpaidFeesPaise: number;
};

export async function getDashboardMetrics(): Promise<DataResult<DashboardMetrics>> {
  try {
    const supabase = await createSupabaseServerClient();

    const [
      totalStudents,
      activeStudents,
      totalTrainers,
      activePrograms,
      activeBatches,
      paidPayments,
      enrollmentTotals,
      processedRefunds,
    ] = await Promise.all([
      supabase.from("students").select("*", { count: "exact", head: true }),
      supabase
        .from("students")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
      supabase.from("trainers").select("*", { count: "exact", head: true }),
      supabase
        .from("programs")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("batches")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
      // One fetch of paid payments, reused below for both revenue and the
      // confirmed-unpaid-fees computation — no need to hit `payments` twice.
      supabase
        .from("payments")
        .select("enrollment_id, total_amount")
        .eq("status", "paid"),
      // One fetch of every Enrollment's id/status/total_payable, reused below
      // for both the Confirmed Enrollments count and the Confirmed Unpaid
      // Fees balance — no separate status='active' count query, so there is
      // no second, independently-filtered read of `enrollments` that could
      // ever disagree with the balance figure.
      supabase.from("enrollments").select("id, total_payable, status"),
      supabase
        .from("payment_refunds")
        .select("amount, payment:payments(enrollment_id)")
        .eq("status", "processed"),
    ]);

    for (const result of [
      totalStudents,
      activeStudents,
      totalTrainers,
      activePrograms,
      activeBatches,
      paidPayments,
      enrollmentTotals,
      processedRefunds,
    ]) {
      if (result.error) throw result.error;
    }

    const refundRows = (processedRefunds.data ?? []).flatMap((r) => {
      const payment = r.payment as unknown as { enrollment_id: string } | null;
      return payment ? [{ enrollment_id: payment.enrollment_id, amount: r.amount }] : [];
    });

    // Root cause of the pre-fix misleading figure: this used to feed EVERY
    // enrollment (any status) into computeOutstandingFeesPaise, so quoted
    // fees for Lead/Applicant and the original fee on Cancelled/Withdrawn
    // records all counted as if they were real receivables. Only Confirmed
    // Enrollments (see CONFIRMED_ENROLLMENT_STATUSES) go into this figure.
    const confirmedEnrollments = (enrollmentTotals.data ?? []).filter((e) =>
      (CONFIRMED_ENROLLMENT_STATUSES as readonly string[]).includes(
        e.status as EnrollmentStatus,
      ),
    );
    const { totalOutstandingPaise } = computeOutstandingFeesPaise(
      confirmedEnrollments,
      paidPayments.data ?? [],
      refundRows,
    );

    return {
      ok: true,
      data: {
        totalStudents: totalStudents.count ?? 0,
        activeStudents: activeStudents.count ?? 0,
        totalTrainers: totalTrainers.count ?? 0,
        activePrograms: activePrograms.count ?? 0,
        activeBatches: activeBatches.count ?? 0,
        confirmedEnrollmentsCount: confirmedEnrollments.length,
        revenueCollectedPaise: computeRevenueCollectedPaise(paidPayments.data ?? []),
        confirmedUnpaidFeesPaise: totalOutstandingPaise,
      },
    };
  } catch (error) {
    return fail("dashboard metrics", error);
  }
}

// ---------------------------------------------------------------------------
// Enrollment financial classification (richer breakdown than the compact
// metric-grid figures) — the single source every dashboard card reads from,
// so Pipeline/Confirmed/Cancelled-or-Withdrawn are never redefined
// per-card. See lib/domain/dashboard-metrics.ts's classification constants
// for the approved status groupings and the Phase 9 report for why the
// prior single "Outstanding Fees" figure was misleading.

export type EnrollmentFinancialClassificationSummary = {
  // Section A — Potential Pipeline Value: raw sum of Lead/Applicant
  // Enrollments' own total_payable snapshots. Indicative only, never a
  // receivable — no payments/refunds involved.
  pipelineValuePaise: number;
  pipelineEnrollmentCount: number;
  // Section B — Confirmed Unpaid Fees: the authoritative per-enrollment
  // balance formula (computeOutstandingFeesPaise, unchanged), applied only
  // to Confirmed Enrollments (enrolled/active/on_hold/completed).
  confirmedUnpaidFeesPaise: number;
  confirmedEnrollmentsWithBalance: number;
  // Section C — Cancelled/Withdrawn: count plus the original recorded fee
  // total (raw total_payable sum, same as Pipeline — explicitly NOT a
  // balance, receivable, loss, refund-due, or written-off debt). Any
  // payments already recorded against these Enrollments still contribute
  // to Revenue Collected and payment history unchanged — this figure does
  // not touch payments at all.
  cancelledOrWithdrawnCount: number;
  cancelledOrWithdrawnOriginalFeePaise: number;
};

export async function getEnrollmentFinancialClassificationSummary(): Promise<
  DataResult<EnrollmentFinancialClassificationSummary>
> {
  try {
    const supabase = await createSupabaseServerClient();

    const [enrollments, paidPayments, processedRefunds] = await Promise.all([
      supabase.from("enrollments").select("id, total_payable, status"),
      supabase
        .from("payments")
        .select("enrollment_id, total_amount")
        .eq("status", "paid"),
      supabase
        .from("payment_refunds")
        .select("amount, payment:payments(enrollment_id)")
        .eq("status", "processed"),
    ]);

    if (enrollments.error) throw enrollments.error;
    if (paidPayments.error) throw paidPayments.error;
    if (processedRefunds.error) throw processedRefunds.error;

    const refundRows = (processedRefunds.data ?? []).flatMap((r) => {
      const payment = r.payment as unknown as { enrollment_id: string } | null;
      return payment ? [{ enrollment_id: payment.enrollment_id, amount: r.amount }] : [];
    });

    const allEnrollments = enrollments.data ?? [];
    const isStatusIn = (statuses: readonly string[]) => (e: { status: string }) =>
      statuses.includes(e.status);

    const pipelineEnrollments = allEnrollments.filter(
      isStatusIn(PIPELINE_ENROLLMENT_STATUSES),
    );
    const confirmedEnrollments = allEnrollments.filter(
      isStatusIn(CONFIRMED_ENROLLMENT_STATUSES),
    );
    const cancelledOrWithdrawnEnrollments = allEnrollments.filter(
      isStatusIn(CANCELLED_OR_WITHDRAWN_ENROLLMENT_STATUSES),
    );

    const { totalOutstandingPaise, enrollmentsWithBalance } = computeOutstandingFeesPaise(
      confirmedEnrollments,
      paidPayments.data ?? [],
      refundRows,
    );

    return {
      ok: true,
      data: {
        pipelineValuePaise: sumTotalPayablePaise(pipelineEnrollments),
        pipelineEnrollmentCount: pipelineEnrollments.length,
        confirmedUnpaidFeesPaise: totalOutstandingPaise,
        confirmedEnrollmentsWithBalance: enrollmentsWithBalance,
        cancelledOrWithdrawnCount: cancelledOrWithdrawnEnrollments.length,
        cancelledOrWithdrawnOriginalFeePaise: sumTotalPayablePaise(
          cancelledOrWithdrawnEnrollments,
        ),
      },
    };
  } catch (error) {
    return fail("enrollment financial classification summary", error);
  }
}

// ---------------------------------------------------------------------------
// Recent enrollments (from the enrollment_summary view — DATABASE_SCHEMA.md §9)

export type RecentEnrollment = {
  id: string;
  enrollmentCode: string;
  studentName: string;
  studentCode: string;
  programName: string;
  batchName: string | null;
  enrollmentDate: string;
  status: string;
};

export async function getRecentEnrollments(
  limit: number,
): Promise<DataResult<RecentEnrollment[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("enrollment_summary")
      .select(
        "id, enrollment_code, enrollment_status, enrollment_date, student_first_name, student_last_name, student_code, program_name, batch_name",
      )
      .order("enrollment_date", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        enrollmentCode: row.enrollment_code,
        studentName: `${row.student_first_name} ${row.student_last_name}`,
        studentCode: row.student_code,
        programName: row.program_name,
        batchName: row.batch_name,
        enrollmentDate: row.enrollment_date,
        status: row.enrollment_status,
      })),
    };
  } catch (error) {
    return fail("recent enrollments", error);
  }
}

// ---------------------------------------------------------------------------
// Recent payments

export type RecentPayment = {
  id: string;
  paymentCode: string;
  studentName: string;
  programName: string;
  totalAmountPaise: number;
  status: string;
  paymentDate: string;
};

type RecentPaymentRow = {
  id: string;
  payment_code: string;
  total_amount: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  enrollment: {
    program: { name: string } | null;
    student: { first_name: string; last_name: string } | null;
  } | null;
};

export async function getRecentPayments(
  limit: number,
): Promise<DataResult<RecentPayment[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("payments")
      .select(
        "id, payment_code, total_amount, status, created_at, paid_at, enrollment:enrollments(program:programs(name), student:students(first_name, last_name))",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    const rows = (data ?? []) as unknown as RecentPaymentRow[];

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        paymentCode: row.payment_code,
        studentName: row.enrollment?.student
          ? `${row.enrollment.student.first_name} ${row.enrollment.student.last_name}`
          : "Unknown student",
        programName: row.enrollment?.program?.name ?? "Unknown program",
        totalAmountPaise: sumPaise([row.total_amount]),
        status: row.status,
        paymentDate: row.paid_at ?? row.created_at,
      })),
    };
  } catch (error) {
    return fail("recent payments", error);
  }
}

// ---------------------------------------------------------------------------
// Upcoming class sessions

export type UpcomingClassSession = {
  id: string;
  programName: string;
  batchName: string;
  trainerName: string | null;
  sessionDate: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
};

type UpcomingClassSessionRow = {
  id: string;
  session_date: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  batch: { name: string; program: { name: string } | null } | null;
  trainer: { first_name: string; last_name: string } | null;
};

export async function getUpcomingClassSessions(
  limit: number,
): Promise<DataResult<UpcomingClassSession[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("class_sessions")
      .select(
        "id, session_date, start_time, end_time, status, batch:batches(name, program:programs(name)), trainer:trainers(first_name, last_name)",
      )
      .eq("status", "scheduled")
      .gte("session_date", today)
      .order("session_date", { ascending: true })
      .limit(limit);

    if (error) throw error;

    const rows = (data ?? []) as unknown as UpcomingClassSessionRow[];

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        programName: row.batch?.program?.name ?? "Unknown program",
        batchName: row.batch?.name ?? "Unknown batch",
        trainerName: row.trainer
          ? `${row.trainer.first_name} ${row.trainer.last_name}`
          : null,
        sessionDate: row.session_date,
        startTime: row.start_time,
        endTime: row.end_time,
        status: row.status,
      })),
    };
  } catch (error) {
    return fail("upcoming classes", error);
  }
}
