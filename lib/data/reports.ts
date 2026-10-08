import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import {
  REPORT_DEFINITIONS,
  REPORT_PAGE_SIZE,
  computeEnrollmentFinancialFigures,
  financialGroupStatuses,
  sumFinancialRows,
  type AttendanceReportRow,
  type CertificateReportRow,
  type EnrollmentReportRow,
  type FinancialReportRow,
  type FinancialReportTotals,
  type ReportFilters,
  type ReportKind,
  type ReportRowByKind,
  type StudentReportRow,
  type TrainerReportRow,
} from "@/lib/domain/reports";
import type { StudentStatus } from "@/lib/domain/students";
import type { CertificateStatus } from "@/lib/domain/certificates";
import type { TrainerStatus } from "@/lib/domain/trainers";

/**
 * Reports & Analytics data layer (Phase 19 — REQUIREMENTS.md FR-120).
 * READ ONLY: nothing in this module inserts, updates or deletes anything.
 *
 * Every query runs through the caller's own RLS-scoped session
 * (createSupabaseServerClient), never the service-role client, so the
 * database independently limits what a report can contain: Admin/Super
 * Admin read everything through the existing *_select_admin policies; any
 * other role would see at most its own rows (and is refused before
 * reaching this module by the page/route's own isAdminOrSuperAdmin gate).
 *
 * Authoritative sources, reused rather than re-derived:
 *  - Attendance: the Phase 13 `student_attendance_summary` view
 *    (security_invoker since 20260101000022) — its counts and percentage
 *    are read verbatim; the denominator is sessions MARKED for that
 *    enrollment, so an enrollment with no marked session has no row.
 *  - Money: lib/domain/reports.ts's computeEnrollmentFinancialFigures,
 *    which is getEnrollmentFinancialSummary's own composition of the Phase
 *    14 engine (computeOutstandingFeesPaise / sumPaise / toPaise, integer
 *    paise, payments.status='paid', payment_refunds.status='processed'),
 *    never the enrollments.*_cache columns.
 *  - Certificates: `certificates.status` as stored (issued / revoked stay
 *    distinct); pdf_path is never selected, and no signed URL is created.
 *
 * Determinism: every query orders by the whitelisted sort column(s) and
 * then by a unique tie-breaker (REPORT_DEFINITIONS[kind].tieBreaker), so
 * page N and an export's batch N always contain the same rows for the
 * same data.
 */

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// PostgREST's response cap (Supabase default max-rows = 1000). Helpers that
// need "every matching row" page through in steps of this size instead of
// trusting one unbounded select, which would be silently cut at the cap.
const FETCH_STEP = 1000;

// `in.(…)` lists are sent in the URL; keep each request's list short.
const IN_CHUNK = 100;

// A free-text search is resolved to student ids first for the reports
// whose rows do not carry the student's name. Above this many matches the
// search is refused as too broad rather than truncated.
const MAX_SEARCH_STUDENT_IDS = 200;

class ReportQueryError extends Error {}

function fail<T>(message: string, error: unknown): DataResult<T> {
  if (error instanceof ReportQueryError) return { ok: false, error: error.message };
  console.error(`[reports data] ${message}:`, error);
  return { ok: false, error: message };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Minimal structural type for the builder methods this module chains, so
// the shared ordering helper works across every table/view's builder.
type Orderable = {
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): unknown;
};

function applyOrder<Q extends Orderable>(
  query: Q,
  kind: ReportKind,
  filters: ReportFilters,
): Q {
  const def = REPORT_DEFINITIONS[kind];
  const sort = def.sorts[filters.sort] ?? def.sorts[def.defaultSort];
  let q = query;
  for (const column of sort.columns) {
    q = q.order(column, { ascending: filters.dir === "asc", nullsFirst: false }) as Q;
  }
  for (const column of def.tieBreaker) {
    q = q.order(column, { ascending: true }) as Q;
  }
  return q;
}

function ilikeAny(columns: readonly string[], q: string): string {
  // q is already sanitized by sanitizeReportSearch (no commas, parentheses,
  // quotes, `*`, `%` or `:`), so it cannot alter the or=(…) grammar.
  return columns.map((column) => `${column}.ilike.%${q}%`).join(",");
}

async function resolveStudentIdsForSearch(
  supabase: ServerClient,
  q: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("students")
    .select("id")
    .or(ilikeAny(["student_code", "first_name", "last_name"], q))
    .order("id")
    .limit(MAX_SEARCH_STUDENT_IDS + 1);
  if (error) throw error;
  const ids = (data ?? []).map((row) => row.id);
  if (ids.length > MAX_SEARCH_STUDENT_IDS) {
    throw new ReportQueryError(
      `The search matches more than ${MAX_SEARCH_STUDENT_IDS} students. Refine the search.`,
    );
  }
  return ids;
}

async function resolveBatchIdsForProgram(
  supabase: ServerClient,
  programId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("batches")
    .select("id")
    .eq("program_id", programId)
    .order("id")
    .limit(FETCH_STEP);
  if (error) throw error;
  if ((data ?? []).length >= FETCH_STEP) {
    throw new ReportQueryError("This program has too many batches to filter by.");
  }
  return (data ?? []).map((row) => row.id);
}

type RangeResult<K extends ReportKind> = { rows: ReportRowByKind[K][]; total: number };

const EMPTY = { rows: [], total: 0 };

// ---------------------------------------------------------------------------
// Student report.

type StudentRowDb = {
  id: string;
  student_code: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string;
  status: string;
  registration_date: string;
};

async function fetchStudentRange(
  supabase: ServerClient,
  filters: ReportFilters,
  from: number,
  to: number,
): Promise<RangeResult<"students">> {
  const columns =
    "id, student_code, first_name, last_name, email, phone, status, registration_date";
  // Program/Batch filter: `enrollments!inner` keeps only students with at
  // least one matching enrollment, and PostgREST returns each student once
  // regardless of how many enrollments match — so the count is students,
  // never enrollments.
  const needsEnrollmentJoin = Boolean(filters.programId || filters.batchId);
  let query = supabase
    .from("students")
    .select(
      needsEnrollmentJoin
        ? `${columns}, enrollments!inner(program_id, batch_id)`
        : columns,
      {
        count: "exact",
      },
    );
  if (filters.programId) query = query.eq("enrollments.program_id", filters.programId);
  if (filters.batchId) query = query.eq("enrollments.batch_id", filters.batchId);
  // parseReportFilters only ever yields a value from STUDENT_STATUSES here.
  if (filters.status) query = query.eq("status", filters.status as StudentStatus);
  if (filters.from) query = query.gte("registration_date", filters.from);
  if (filters.to) query = query.lte("registration_date", filters.to);
  if (filters.q) {
    query = query.or(
      ilikeAny(["student_code", "first_name", "last_name", "email", "phone"], filters.q),
    );
  }

  const { data, error, count } = await applyOrder(query, "students", filters).range(
    from,
    to,
  );
  if (error) throw error;
  const rows = (data ?? []) as unknown as StudentRowDb[];

  // Enrollment count per student on this page (all of the student's
  // enrollments, independent of the Program/Batch filter above).
  const counts = new Map<string, number>();
  for (const ids of chunk(
    rows.map((r) => r.id),
    IN_CHUNK,
  )) {
    const { data: enrollmentRows, error: enrollmentError } = await supabase
      .from("enrollments")
      .select("student_id")
      .in("student_id", ids)
      .limit(FETCH_STEP);
    if (enrollmentError) throw enrollmentError;
    if ((enrollmentRows ?? []).length >= FETCH_STEP) {
      throw new ReportQueryError("Too many enrollments to count on one page.");
    }
    for (const row of enrollmentRows ?? []) {
      counts.set(row.student_id, (counts.get(row.student_id) ?? 0) + 1);
    }
  }

  return {
    total: count ?? 0,
    rows: rows.map((r): StudentReportRow => ({
      id: r.id,
      studentCode: r.student_code,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      phone: r.phone,
      status: r.status,
      registrationDate: r.registration_date,
      enrollmentCount: counts.get(r.id) ?? 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// Enrollment + Financial reports (both read the enrollment_summary view,
// security_invoker — Admin RLS on enrollments/students/programs/batches).

type EnrollmentSummaryDb = {
  id: string;
  enrollment_code: string;
  enrollment_date: string;
  enrollment_status: string;
  total_payable: string | number;
  student_code: string;
  student_first_name: string;
  student_last_name: string;
  program_name: string;
  batch_name: string | null;
};

const ENROLLMENT_SUMMARY_COLUMNS =
  "id, enrollment_code, enrollment_date, enrollment_status, student_code, student_first_name, student_last_name, program_name, batch_name";

function enrollmentSummaryQuery(
  supabase: ServerClient,
  filters: ReportFilters,
  columns: string,
  options: { count?: "exact"; statuses?: readonly string[] | null },
) {
  let query = supabase
    .from("enrollment_summary")
    .select(columns, options.count ? { count: options.count } : undefined);
  if (filters.status) query = query.eq("enrollment_status", filters.status);
  if (options.statuses) query = query.in("enrollment_status", [...options.statuses]);
  if (filters.programId) query = query.eq("program_id", filters.programId);
  if (filters.batchId) query = query.eq("batch_id", filters.batchId);
  if (filters.from) query = query.gte("enrollment_date", filters.from);
  if (filters.to) query = query.lte("enrollment_date", filters.to);
  if (filters.q) {
    query = query.or(
      ilikeAny(
        ["enrollment_code", "student_code", "student_first_name", "student_last_name"],
        filters.q,
      ),
    );
  }
  return query;
}

async function fetchEnrollmentRange(
  supabase: ServerClient,
  filters: ReportFilters,
  from: number,
  to: number,
): Promise<RangeResult<"enrollments">> {
  const query = enrollmentSummaryQuery(supabase, filters, ENROLLMENT_SUMMARY_COLUMNS, {
    count: "exact",
  });
  const { data, error, count } = await applyOrder(query, "enrollments", filters).range(
    from,
    to,
  );
  if (error) throw error;
  return {
    total: count ?? 0,
    rows: ((data ?? []) as unknown as EnrollmentSummaryDb[]).map(
      (r): EnrollmentReportRow => ({
        id: r.id,
        enrollmentCode: r.enrollment_code,
        enrollmentDate: r.enrollment_date,
        status: r.enrollment_status,
        studentCode: r.student_code,
        studentFirstName: r.student_first_name,
        studentLastName: r.student_last_name,
        programName: r.program_name,
        batchName: r.batch_name,
      }),
    ),
  };
}

type PaidPaymentDb = { enrollment_id: string; total_amount: string | number };
type ProcessedRefundDb = { enrollment_id: string; amount: string | number };

// The same two reads getEnrollmentFinancialSummary performs (paid payments,
// processed refunds joined to their payment's enrollment), for a set of
// enrollments at once.
async function fetchFinancialLegs(
  supabase: ServerClient,
  enrollmentIds: readonly string[],
): Promise<{ paid: PaidPaymentDb[]; refunds: ProcessedRefundDb[] }> {
  const paid: PaidPaymentDb[] = [];
  const refunds: ProcessedRefundDb[] = [];
  for (const ids of chunk(enrollmentIds, IN_CHUNK)) {
    for (let offset = 0; ; offset += FETCH_STEP) {
      const { data, error } = await supabase
        .from("payments")
        .select("id, enrollment_id, total_amount")
        .eq("status", "paid")
        .in("enrollment_id", ids)
        .order("id")
        .range(offset, offset + FETCH_STEP - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        paid.push({ enrollment_id: row.enrollment_id, total_amount: row.total_amount });
      }
      if ((data ?? []).length < FETCH_STEP) break;
    }
    for (let offset = 0; ; offset += FETCH_STEP) {
      const { data, error } = await supabase
        .from("payment_refunds")
        .select("id, amount, payment:payments!inner(enrollment_id)")
        .eq("status", "processed")
        .in("payment.enrollment_id", ids)
        .order("id")
        .range(offset, offset + FETCH_STEP - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        const payment = row.payment as unknown as { enrollment_id: string } | null;
        if (payment) {
          refunds.push({
            enrollment_id: payment.enrollment_id,
            amount: row.amount as unknown as string,
          });
        }
      }
      if ((data ?? []).length < FETCH_STEP) break;
    }
  }
  return { paid, refunds };
}

function toFinancialRows(
  summaries: readonly EnrollmentSummaryDb[],
  legs: { paid: PaidPaymentDb[]; refunds: ProcessedRefundDb[] },
): FinancialReportRow[] {
  return summaries.map((r) => ({
    id: r.id,
    enrollmentCode: r.enrollment_code,
    enrollmentDate: r.enrollment_date,
    status: r.enrollment_status,
    studentCode: r.student_code,
    studentFirstName: r.student_first_name,
    studentLastName: r.student_last_name,
    programName: r.program_name,
    batchName: r.batch_name,
    ...computeEnrollmentFinancialFigures(
      { id: r.id, total_payable: r.total_payable },
      legs.paid,
      legs.refunds,
    ),
  }));
}

async function fetchFinancialRange(
  supabase: ServerClient,
  filters: ReportFilters,
  from: number,
  to: number,
): Promise<RangeResult<"financial">> {
  const query = enrollmentSummaryQuery(
    supabase,
    filters,
    `${ENROLLMENT_SUMMARY_COLUMNS}, total_payable`,
    { count: "exact", statuses: financialGroupStatuses(filters.group) },
  );
  const { data, error, count } = await applyOrder(query, "financial", filters).range(
    from,
    to,
  );
  if (error) throw error;
  const summaries = (data ?? []) as unknown as EnrollmentSummaryDb[];
  const legs = await fetchFinancialLegs(
    supabase,
    summaries.map((s) => s.id),
  );
  return { total: count ?? 0, rows: toFinancialRows(summaries, legs) };
}

// ---------------------------------------------------------------------------
// Attendance report (Phase 13 view, read verbatim).

type AttendanceSummaryDb = {
  enrollment_id: string;
  student_id: string;
  batch_id: string;
  total_sessions: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
  attendance_percentage: string | number | null;
};

async function fetchAttendanceRange(
  supabase: ServerClient,
  filters: ReportFilters,
  from: number,
  to: number,
): Promise<RangeResult<"attendance">> {
  let query = supabase
    .from("student_attendance_summary")
    .select(
      "enrollment_id, student_id, batch_id, total_sessions, present_count, absent_count, late_count, excused_count, attendance_percentage",
      { count: "exact" },
    );
  if (filters.batchId) query = query.eq("batch_id", filters.batchId);
  if (filters.programId) {
    const batchIds = await resolveBatchIdsForProgram(supabase, filters.programId);
    if (batchIds.length === 0) return EMPTY;
    query = query.in("batch_id", batchIds);
  }
  if (filters.q) {
    const studentIds = await resolveStudentIdsForSearch(supabase, filters.q);
    if (studentIds.length === 0) return EMPTY;
    query = query.in("student_id", studentIds);
  }
  if (filters.below !== null) query = query.lt("attendance_percentage", filters.below);

  const { data, error, count } = await applyOrder(query, "attendance", filters).range(
    from,
    to,
  );
  if (error) throw error;
  const rows = (data ?? []) as unknown as AttendanceSummaryDb[];
  if (rows.length === 0) return { rows: [], total: count ?? 0 };

  const enrollmentIds = [...new Set(rows.map((r) => r.enrollment_id))];
  const studentIds = [...new Set(rows.map((r) => r.student_id))];
  const batchIds = [...new Set(rows.map((r) => r.batch_id))];

  const [enrollments, students, batches] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id, enrollment_code, program:programs(name)")
      .in("id", enrollmentIds),
    supabase
      .from("students")
      .select("id, student_code, first_name, last_name")
      .in("id", studentIds),
    supabase.from("batches").select("id, name").in("id", batchIds),
  ]);
  if (enrollments.error) throw enrollments.error;
  if (students.error) throw students.error;
  if (batches.error) throw batches.error;

  const enrollmentById = new Map(
    (
      (enrollments.data ?? []) as unknown as Array<{
        id: string;
        enrollment_code: string;
        program: { name: string } | null;
      }>
    ).map((e) => [e.id, e]),
  );
  const studentById = new Map((students.data ?? []).map((s) => [s.id, s]));
  const batchById = new Map((batches.data ?? []).map((b) => [b.id, b]));

  return {
    total: count ?? 0,
    rows: rows.map((r): AttendanceReportRow => {
      const enrollment = enrollmentById.get(r.enrollment_id);
      const student = studentById.get(r.student_id);
      return {
        enrollmentId: r.enrollment_id,
        batchId: r.batch_id,
        enrollmentCode: enrollment?.enrollment_code ?? "",
        studentCode: student?.student_code ?? "",
        studentFirstName: student?.first_name ?? "",
        studentLastName: student?.last_name ?? "",
        programName: enrollment?.program?.name ?? "",
        batchName: batchById.get(r.batch_id)?.name ?? "",
        totalSessions: Number(r.total_sessions),
        presentCount: Number(r.present_count),
        lateCount: Number(r.late_count),
        absentCount: Number(r.absent_count),
        excusedCount: Number(r.excused_count),
        attendancePercentage: r.attendance_percentage,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Certificate report. pdf_path is deliberately absent from the select.

type CertificateDb = {
  id: string;
  certificate_number: string;
  status: string;
  issue_date: string;
  completion_date: string;
  revoked_at: string | null;
  student: { student_code: string; first_name: string; last_name: string } | null;
  program: { name: string } | null;
  enrollment: { enrollment_code: string } | null;
};

async function fetchCertificateRange(
  supabase: ServerClient,
  filters: ReportFilters,
  from: number,
  to: number,
): Promise<RangeResult<"certificates">> {
  let query = supabase
    .from("certificates")
    .select(
      "id, certificate_number, status, issue_date, completion_date, revoked_at, student:students(student_code, first_name, last_name), program:programs(name), enrollment:enrollments(enrollment_code)",
      { count: "exact" },
    );
  // parseReportFilters only ever yields a value from CERTIFICATE_STATUSES.
  if (filters.status) query = query.eq("status", filters.status as CertificateStatus);
  if (filters.programId) query = query.eq("program_id", filters.programId);
  if (filters.from) query = query.gte("issue_date", filters.from);
  if (filters.to) query = query.lte("issue_date", filters.to);
  if (filters.q) {
    const studentIds = await resolveStudentIdsForSearch(supabase, filters.q);
    const numberMatch = `certificate_number.ilike.%${filters.q}%`;
    query = query.or(
      studentIds.length > 0
        ? `${numberMatch},student_id.in.(${studentIds.join(",")})`
        : numberMatch,
    );
  }

  const { data, error, count } = await applyOrder(query, "certificates", filters).range(
    from,
    to,
  );
  if (error) throw error;
  return {
    total: count ?? 0,
    rows: ((data ?? []) as unknown as CertificateDb[]).map((r): CertificateReportRow => ({
      id: r.id,
      certificateNumber: r.certificate_number,
      status: r.status,
      issueDate: r.issue_date,
      completionDate: r.completion_date,
      revokedAt: r.revoked_at,
      studentCode: r.student?.student_code ?? "",
      studentFirstName: r.student?.first_name ?? "",
      studentLastName: r.student?.last_name ?? "",
      programName: r.program?.name ?? "",
      enrollmentCode: r.enrollment?.enrollment_code ?? "",
    })),
  };
}

// ---------------------------------------------------------------------------
// Trainer report (FR-120). Reads `trainers` (trainers_select_admin) and
// `batch_trainers` (batch_trainers_select_admin) only. auth_user_id and bio
// are deliberately absent from the select. One row per trainer: the
// assigned-batch count is computed per page in a second query rather than
// by joining batch_trainers into the paged query.

type TrainerRowDb = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  status: string;
  specialization: string[] | null;
  created_at: string;
};

async function fetchTrainerRange(
  supabase: ServerClient,
  filters: ReportFilters,
  from: number,
  to: number,
): Promise<RangeResult<"trainers">> {
  let query = supabase
    .from("trainers")
    .select(
      "id, first_name, last_name, email, phone, status, specialization, created_at",
      {
        count: "exact",
      },
    );
  // parseReportFilters only ever yields a value from TRAINER_STATUSES here.
  if (filters.status) query = query.eq("status", filters.status as TrainerStatus);
  if (filters.q) {
    query = query.or(ilikeAny(["first_name", "last_name", "email", "phone"], filters.q));
  }

  const { data, error, count } = await applyOrder(query, "trainers", filters).range(
    from,
    to,
  );
  if (error) throw error;
  const rows = (data ?? []) as unknown as TrainerRowDb[];

  const assigned = new Map<string, number>();
  for (const ids of chunk(
    rows.map((r) => r.id),
    IN_CHUNK,
  )) {
    const { data: assignmentRows, error: assignmentError } = await supabase
      .from("batch_trainers")
      .select("trainer_id")
      .in("trainer_id", ids)
      .limit(FETCH_STEP);
    if (assignmentError) throw assignmentError;
    if ((assignmentRows ?? []).length >= FETCH_STEP) {
      throw new ReportQueryError("Too many batch assignments to count on one page.");
    }
    for (const row of assignmentRows ?? []) {
      assigned.set(row.trainer_id, (assigned.get(row.trainer_id) ?? 0) + 1);
    }
  }

  return {
    total: count ?? 0,
    rows: rows.map((r): TrainerReportRow => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      phone: r.phone,
      status: r.status,
      specialization: r.specialization ?? [],
      createdAt: r.created_at,
      assignedBatchCount: assigned.get(r.id) ?? 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// Public API.

const FETCHERS: {
  [K in ReportKind]: (
    supabase: ServerClient,
    filters: ReportFilters,
    from: number,
    to: number,
  ) => Promise<RangeResult<K>>;
} = {
  students: fetchStudentRange,
  enrollments: fetchEnrollmentRange,
  attendance: fetchAttendanceRange,
  financial: fetchFinancialRange,
  certificates: fetchCertificateRange,
  trainers: fetchTrainerRange,
};

const LOAD_ERROR: Record<ReportKind, string> = {
  students: "Could not load the student report.",
  enrollments: "Could not load the enrollment report.",
  attendance: "Could not load the attendance report.",
  financial: "Could not load the financial report.",
  certificates: "Could not load the certificate report.",
  trainers: "Could not load the trainer report.",
};

/**
 * Rows `from`..`to` (inclusive, zero-based) of a report under the given
 * filters, plus the total matching row count. Used by both the on-screen
 * page (one page) and the CSV export (successive batches).
 */
export async function fetchReportRange<K extends ReportKind>(
  kind: K,
  filters: ReportFilters,
  from: number,
  to: number,
): Promise<DataResult<RangeResult<K>>> {
  try {
    const supabase = await createSupabaseServerClient();
    const data = await FETCHERS[kind](supabase, filters, from, to);
    return { ok: true, data };
  } catch (error) {
    return fail(LOAD_ERROR[kind], error);
  }
}

export type ReportPage<K extends ReportKind> = RangeResult<K> & {
  page: number;
  pageSize: number;
};

export async function getReportPage<K extends ReportKind>(
  kind: K,
  filters: ReportFilters,
): Promise<DataResult<ReportPage<K>>> {
  const from = (filters.page - 1) * REPORT_PAGE_SIZE;
  const result = await fetchReportRange(kind, filters, from, from + REPORT_PAGE_SIZE - 1);
  if (!result.ok) return result;
  return {
    ok: true,
    data: { ...result.data, page: filters.page, pageSize: REPORT_PAGE_SIZE },
  };
}

/**
 * Totals for the WHOLE filtered Financial report (not just the visible
 * page): the sum of each enrollment's own engine figures. With the default
 * "Confirmed" group and no other filter, `outstandingPaise` equals the
 * dashboard's Confirmed Unpaid Fees (same engine, same status set).
 */
export async function getFinancialReportTotals(
  filters: ReportFilters,
): Promise<DataResult<FinancialReportTotals>> {
  try {
    const supabase = await createSupabaseServerClient();
    const summaries: EnrollmentSummaryDb[] = [];
    for (let offset = 0; ; offset += FETCH_STEP) {
      const query = enrollmentSummaryQuery(
        supabase,
        filters,
        `${ENROLLMENT_SUMMARY_COLUMNS}, total_payable`,
        { statuses: financialGroupStatuses(filters.group) },
      );
      const { data, error } = await query
        .order("id")
        .range(offset, offset + FETCH_STEP - 1);
      if (error) throw error;
      summaries.push(...((data ?? []) as unknown as EnrollmentSummaryDb[]));
      if ((data ?? []).length < FETCH_STEP) break;
    }
    const legs = await fetchFinancialLegs(
      supabase,
      summaries.map((s) => s.id),
    );
    return { ok: true, data: sumFinancialRows(toFinancialRows(summaries, legs)) };
  } catch (error) {
    return fail("Could not load the financial totals.", error);
  }
}

// ---------------------------------------------------------------------------
// Filter dropdown options.

export type ReportFilterOptions = {
  programs: Array<{ id: string; name: string }>;
  batches: Array<{ id: string; name: string }>;
};

export async function getReportFilterOptions(): Promise<DataResult<ReportFilterOptions>> {
  try {
    const supabase = await createSupabaseServerClient();
    const [programs, batches] = await Promise.all([
      supabase.from("programs").select("id, name").order("name").order("id"),
      supabase.from("batches").select("id, name").order("name").order("id"),
    ]);
    if (programs.error) throw programs.error;
    if (batches.error) throw batches.error;
    return {
      ok: true,
      data: { programs: programs.data ?? [], batches: batches.data ?? [] },
    };
  } catch (error) {
    return fail("Could not load the filter options.", error);
  }
}

// ---------------------------------------------------------------------------
// Analytics overview — simple counts for the Reports landing page. Money
// figures are NOT computed here: the page reuses the dashboard's own
// getDashboardMetrics / getEnrollmentFinancialClassificationSummary.

export type ReportsOverview = {
  attendanceMarked: number;
  attendancePresentOrLate: number;
  certificatesIssued: number;
  certificatesRevoked: number;
};

export async function getReportsOverview(): Promise<DataResult<ReportsOverview>> {
  try {
    const supabase = await createSupabaseServerClient();
    const [marked, presentOrLate, issued, revoked] = await Promise.all([
      supabase.from("attendance").select("id", { count: "exact", head: true }),
      supabase
        .from("attendance")
        .select("id", { count: "exact", head: true })
        .in("status", ["present", "late"]),
      supabase
        .from("certificates")
        .select("id", { count: "exact", head: true })
        .eq("status", "issued"),
      supabase
        .from("certificates")
        .select("id", { count: "exact", head: true })
        .eq("status", "revoked"),
    ]);
    for (const result of [marked, presentOrLate, issued, revoked]) {
      if (result.error) throw result.error;
    }
    return {
      ok: true,
      data: {
        attendanceMarked: marked.count ?? 0,
        attendancePresentOrLate: presentOrLate.count ?? 0,
        certificatesIssued: issued.count ?? 0,
        certificatesRevoked: revoked.count ?? 0,
      },
    };
  } catch (error) {
    return fail("Could not load the report overview.", error);
  }
}
