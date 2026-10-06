import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import { getEnrollmentFinancialSummary } from "@/lib/data/enrollments";
import {
  getPaymentPlanForEnrollment,
  type PaymentPlanRow,
} from "@/lib/data/payment-plans";
import type { EnrollmentStatus } from "@/lib/domain/enrollments";
import type { StudentSelfProfileInput } from "@/lib/validation/student-self-profile";
import { toMaterialRow, type MaterialRow } from "@/lib/data/materials";

/**
 * Student Portal data-access layer (Phase 10). Deliberately separate from
 * lib/data/students.ts / lib/data/enrollments.ts (the Admin-facing modules)
 * rather than reusing them: those return fields (discount reason, source,
 * notes, audit-oriented data) that are appropriate for an Admin managing the
 * record but not for a Student viewing their own — see the Phase 10 report
 * for the exact projection decision.
 *
 * Every function below resolves "which student" from the caller's own
 * authenticated session (auth.getUser()) and filters by it directly in the
 * query — never from a caller-supplied id. This is deliberate defense in
 * depth alongside this project's RLS (students_select_own/students_update_own
 * on `students`, enrollments_select_own on `enrollments` —
 * supabase/migrations/20260101000014_rls_policies.sql): even if a policy
 * ever had a gap, there is no parameter shape here a caller could use to ask
 * for another student's data.
 */

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[student-portal data] ${message}:`, error);
  return { ok: false, error: message };
}

export type MyStudentProfile = {
  id: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string;
  alternatePhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  registrationDate: string;
  status: "active" | "inactive" | "archived";
};

export async function getMyStudentProfile(): Promise<DataResult<MyStudentProfile>> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };

    const { data, error } = await supabase
      .from("students")
      .select(
        "id, student_code, first_name, last_name, preferred_name, email, phone, alternate_phone, address_line1, address_line2, city, state, postal_code, registration_date, status",
      )
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: false, error: "Student profile not found." };

    return {
      ok: true,
      data: {
        id: data.id,
        studentCode: data.student_code,
        firstName: data.first_name,
        lastName: data.last_name,
        preferredName: data.preferred_name,
        email: data.email,
        phone: data.phone,
        alternatePhone: data.alternate_phone,
        addressLine1: data.address_line1,
        addressLine2: data.address_line2,
        city: data.city,
        state: data.state,
        postalCode: data.postal_code,
        registrationDate: data.registration_date,
        status: data.status,
      },
    };
  } catch (error) {
    return fail("Could not load your profile.", error);
  }
}

// Column list is intentionally exactly REQUIREMENTS.md FR-41's allowed set
// (phone, alternate phone, address). Even if this ever received an extra
// field, the database's own prevent_student_self_edit_of_protected_fields
// trigger independently rejects any other column changing on this row, and
// `.eq("auth_user_id", user.id)` below means the update can only ever
// target the caller's own row.
export async function updateMyStudentProfile(
  input: StudentSelfProfileInput,
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };

    const { error } = await supabase
      .from("students")
      .update({
        phone: input.phone,
        alternate_phone: input.alternatePhone ?? null,
        address_line1: input.addressLine1 ?? null,
        address_line2: input.addressLine2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postal_code: input.postalCode ?? null,
      })
      .eq("auth_user_id", user.id);

    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not save changes. Please try again.", error);
  }
}

async function resolveMyStudentId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<DataResult<string>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("students")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "Student profile not found." };
  return { ok: true, data: data.id };
}

// Safe projection for Student-facing enrollment information
// (REQUIREMENTS.md FR-42, Phase 10 scope): enrollment code, program, batch,
// status, dates, and a payment-status summary (FR-40) — never the fee
// breakdown (regular/agreed/discount/registration/tax), discount reason,
// source, or admin notes that lib/data/enrollments.ts's EnrollmentProfile
// carries for the Admin UI. See the Phase 10 report for this decision.
export type MyEnrollmentRow = {
  id: string;
  enrollmentCode: string;
  programName: string;
  programCode: string;
  batchName: string | null;
  status: EnrollmentStatus;
  enrollmentDate: string;
  totalPayablePaise: number;
  outstandingPaise: number;
};

type EnrollmentJoinRow = {
  id: string;
  enrollment_code: string;
  status: EnrollmentStatus;
  enrollment_date: string;
  total_payable: string;
  program: { name: string; program_code: string } | null;
  batch: { name: string } | null;
};

async function toMyEnrollmentRow(
  row: EnrollmentJoinRow,
): Promise<DataResult<MyEnrollmentRow>> {
  const summary = await getEnrollmentFinancialSummary(row.id, row.total_payable);
  if (!summary.ok) return summary;
  return {
    ok: true,
    data: {
      id: row.id,
      enrollmentCode: row.enrollment_code,
      programName: row.program?.name ?? "Unknown program",
      programCode: row.program?.program_code ?? "—",
      batchName: row.batch?.name ?? null,
      status: row.status,
      enrollmentDate: row.enrollment_date,
      totalPayablePaise: summary.data.totalPayablePaise,
      outstandingPaise: summary.data.outstandingPaise,
    },
  };
}

export async function getMyEnrollments(): Promise<DataResult<MyEnrollmentRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const studentId = await resolveMyStudentId(supabase);
    if (!studentId.ok) return studentId;

    const { data, error } = await supabase
      .from("enrollments")
      .select(
        "id, enrollment_code, status, enrollment_date, total_payable, program:programs(name, program_code), batch:batches(name)",
      )
      .eq("student_id", studentId.data)
      .order("enrollment_date", { ascending: false });

    if (error) throw error;

    const rows: MyEnrollmentRow[] = [];
    for (const row of (data ?? []) as unknown as EnrollmentJoinRow[]) {
      const result = await toMyEnrollmentRow(row);
      if (!result.ok) throw new Error(result.error);
      rows.push(result.data);
    }

    return { ok: true, data: rows };
  } catch (error) {
    return fail("Could not load your enrollments.", error);
  }
}

// Deliberately re-checks `student_id` against the caller's own resolved id
// (not just `id`) — this is the exact query a direct-URL/ID-manipulation
// attempt against another student's enrollment must fail against (Phase 10
// DoD, IMPLEMENTATION_PLAN.md). A mismatched id returns the same
// "not found" as a genuinely nonexistent enrollment, never a distinct
// "not yours" response, so this can't be used to probe which enrollment
// ids exist.
export async function getMyEnrollment(
  enrollmentId: string,
): Promise<DataResult<MyEnrollmentRow>> {
  try {
    const supabase = await createSupabaseServerClient();
    const studentId = await resolveMyStudentId(supabase);
    if (!studentId.ok) return studentId;

    const { data, error } = await supabase
      .from("enrollments")
      .select(
        "id, enrollment_code, status, enrollment_date, total_payable, program:programs(name, program_code), batch:batches(name)",
      )
      .eq("id", enrollmentId)
      .eq("student_id", studentId.data)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: false, error: "Enrollment not found." };

    return toMyEnrollmentRow(data as unknown as EnrollmentJoinRow);
  } catch (error) {
    return fail("Could not load this enrollment.", error);
  }
}

// ---------------------------------------------------------------------------
// Student dashboard "Upcoming classes" widget (IMPLEMENTATION_PLAN.md Phase
// 12 — "closing the placeholders from Phases 4/10/11"). Relies entirely on
// the pre-existing class_sessions_select_student RLS policy (scoped via
// enrollments to current_student_id(), 20260101000014_rls_policies.sql) to
// return only sessions for batches the caller is actually enrolled in —
// there is no student_id/batch_id filter in this query because none is
// needed: RLS already restricts every row this client can see. Read-only;
// Students have no class_sessions write policy at all.

export type MyUpcomingClassSession = {
  id: string;
  batchName: string;
  programName: string;
  sessionDate: string;
  startTime: string | null;
  endTime: string | null;
};

export async function getMyUpcomingClassSessions(
  limit: number,
): Promise<DataResult<MyUpcomingClassSession[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("class_sessions")
      .select(
        "id, session_date, start_time, end_time, batch:batches(name, program:programs(name))",
      )
      .eq("status", "scheduled")
      .gte("session_date", today)
      .order("session_date", { ascending: true })
      .limit(limit);
    if (error) throw error;

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      session_date: string;
      start_time: string | null;
      end_time: string | null;
      batch: { name: string; program: { name: string } | null } | null;
    }>;

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        batchName: row.batch?.name ?? "Unknown batch",
        programName: row.batch?.program?.name ?? "Unknown program",
        sessionDate: row.session_date,
        startTime: row.start_time,
        endTime: row.end_time,
      })),
    };
  } catch (error) {
    return fail("Could not load your upcoming classes.", error);
  }
}

// ---------------------------------------------------------------------------
// Attendance (Phase 13 — REQUIREMENTS.md FR-44/62, IMPLEMENTATION_PLAN.md
// Phase 13 — "closing the Phase 10 placeholder"). student_attendance_summary
// (supabase/migrations/20260101000011_views.sql) is declared
// `security_invoker = true` (20260101000013_rls_lockdown.sql), so it
// inherits the caller's own RLS on the underlying `attendance` table
// (attendance_select_own, scoped to current_student_id()) rather than the
// view owner's — a Student querying it only ever sees rows for their own
// enrollments, the same guarantee as every other Student Portal query in
// this file. FR-62 ("computed on read ... not manually maintained") is
// satisfied by this view doing the aggregation in SQL; nothing here
// recomputes it.
//
// Individual per-session records intentionally omit `notes` and
// `marked_by`/`marked_by_type` — FR-44 requires only the status and the
// computed percentage, not the Trainer/Admin's own correction notes or who
// marked it, and neither is otherwise authorized for Student visibility.

export type MyAttendanceSummaryRow = {
  enrollmentId: string;
  totalSessions: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedCount: number;
  attendancePercentage: number | null;
};

export async function getMyAttendanceSummary(): Promise<
  DataResult<MyAttendanceSummaryRow[]>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("student_attendance_summary")
      .select(
        "enrollment_id, total_sessions, present_count, absent_count, late_count, excused_count, attendance_percentage",
      );
    if (error) throw error;

    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        enrollmentId: row.enrollment_id,
        totalSessions: row.total_sessions,
        presentCount: row.present_count,
        absentCount: row.absent_count,
        lateCount: row.late_count,
        excusedCount: row.excused_count,
        attendancePercentage: row.attendance_percentage,
      })),
    };
  } catch (error) {
    return fail("Could not load your attendance summary.", error);
  }
}

export type MyAttendanceRecordRow = {
  id: string;
  sessionDate: string;
  topic: string | null;
  status: "present" | "absent" | "late" | "excused";
};

// Re-checks ownership via getMyEnrollment (student_id-scoped, same
// direct-URL/ID-manipulation defense as every other per-enrollment query in
// this file) before reading any attendance row for it — attendance_select_own
// RLS already enforces this independently, but this module never relies on
// RLS alone.
export async function getMyAttendanceForEnrollment(
  enrollmentId: string,
): Promise<
  DataResult<{ summary: MyAttendanceSummaryRow | null; records: MyAttendanceRecordRow[] }>
> {
  const enrollment = await getMyEnrollment(enrollmentId);
  if (!enrollment.ok) return enrollment;

  try {
    const supabase = await createSupabaseServerClient();

    const { data: summaryRow, error: summaryError } = await supabase
      .from("student_attendance_summary")
      .select(
        "enrollment_id, total_sessions, present_count, absent_count, late_count, excused_count, attendance_percentage",
      )
      .eq("enrollment_id", enrollmentId)
      .maybeSingle();
    if (summaryError) throw summaryError;

    // Sorted in application code below rather than via `.order()` — PostgREST
    // embedded-resource ordering syntax is not something this codebase uses
    // anywhere else, so this avoids relying on behavior nothing else here
    // already proves works.
    const { data: records, error: recordsError } = await supabase
      .from("attendance")
      .select("id, status, class_session:class_sessions(session_date, topic)")
      .eq("enrollment_id", enrollmentId);
    if (recordsError) throw recordsError;

    const recordRows = (records ?? []) as unknown as Array<{
      id: string;
      status: "present" | "absent" | "late" | "excused";
      class_session: { session_date: string; topic: string | null } | null;
    }>;

    return {
      ok: true,
      data: {
        summary: summaryRow
          ? {
              enrollmentId: summaryRow.enrollment_id,
              totalSessions: summaryRow.total_sessions,
              presentCount: summaryRow.present_count,
              absentCount: summaryRow.absent_count,
              lateCount: summaryRow.late_count,
              excusedCount: summaryRow.excused_count,
              attendancePercentage: summaryRow.attendance_percentage,
            }
          : null,
        records: recordRows
          .filter((row) => row.class_session !== null)
          .map((row) => ({
            id: row.id,
            sessionDate: row.class_session!.session_date,
            topic: row.class_session!.topic,
            status: row.status,
          }))
          .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate)),
      },
    };
  } catch (error) {
    return fail("Could not load attendance for this enrollment.", error);
  }
}

export type MyInstallmentRow = {
  id: string;
  sequence: number;
  label: string | null;
  amount: string;
  dueDate: string;
  status: PaymentPlanRow["installments"][number]["displayStatus"];
};

export type MyPaymentPlanRow = {
  id: string;
  totalAmount: string;
  installments: MyInstallmentRow[];
};

// Same ownership re-check as getMyAttendanceForEnrollment above — RLS
// (payment_plans_select_own/installments_select_own) already scopes this
// independently, but this module never relies on RLS alone. Returns a
// trimmed, Student-safe projection of lib/data/payment-plans.ts's own
// PaymentPlanRow: no `editable`/`storedStatus` (internal fields with no
// meaning for a Student, who can never mutate a plan — RLS grants Student
// select-only on both tables), just what FR-43/FR-96 ask for: the
// installment schedule with its computed status. `null` (no plan yet) is a
// valid state, not an error — same convention as
// getMyAttendanceForEnrollment's own `summary: null`.
export async function getMyPaymentPlanForEnrollment(
  enrollmentId: string,
): Promise<DataResult<MyPaymentPlanRow | null>> {
  const enrollment = await getMyEnrollment(enrollmentId);
  if (!enrollment.ok) return enrollment;

  const plan = await getPaymentPlanForEnrollment(enrollmentId);
  if (!plan.ok) return plan;
  if (!plan.data) return { ok: true, data: null };

  return {
    ok: true,
    data: {
      id: plan.data.id,
      totalAmount: plan.data.totalAmount,
      installments: plan.data.installments.map((i) => ({
        id: i.id,
        sequence: i.sequence,
        label: i.label,
        amount: i.amount,
        dueDate: i.dueDate,
        status: i.displayStatus,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Materials (Phase 15) — read-only, scoped to the caller's own Enrollment.
// Surfaces ALL FOUR scope branches an eligible Student may be authorized
// for (Program, Batch, Module-of-their-Program, Session-of-their-Batch) in
// one coherent section on the Enrollment detail page — not just Program/
// Batch. FR-70 allows Admin/Trainer to scope a material to any of the four;
// FR-71 requires Student access to materials be usable, not merely RLS-true
// with no way to discover them, so a Module/Session-scoped material an
// eligible Student is authorized for (materials_select_student,
// 20260101000026) must actually be reachable here too, same architecture
// as lib/data/materials.ts's own getProgramMaterialsIncludingModules (Admin
// Program page) — no new route, one existing page, every authorized scope
// merged into one list. materials_select_student (enrolled/active/on_hold/
// completed only) is the real authorization boundary throughout; this
// query re-verifies enrollment ownership first (own id + own student_id)
// so even a nonexistent/unrelated enrollment id gets the same safe
// "not found" response every other Student Portal read already uses.

const MATERIAL_COLUMNS =
  "id, title, description, material_type, file_path, external_url, uploaded_by_type, created_at";

type MaterialQueryRow = {
  id: string;
  title: string;
  description: string | null;
  material_type: MaterialRow["materialType"];
  file_path: string | null;
  external_url: string | null;
  uploaded_by_type: "admin" | "trainer";
  created_at: string;
};

export async function getMyMaterialsForEnrollment(
  enrollmentId: string,
): Promise<DataResult<MaterialRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const studentId = await resolveMyStudentId(supabase);
    if (!studentId.ok) return studentId;

    const { data: enrollment, error: enrollmentError } = await supabase
      .from("enrollments")
      .select("id, program_id, batch_id")
      .eq("id", enrollmentId)
      .eq("student_id", studentId.data)
      .maybeSingle();
    if (enrollmentError) throw enrollmentError;
    if (!enrollment) return { ok: false, error: "Enrollment not found." };

    // Module/Session ids (and their display labels) are resolved from the
    // Enrollment's own Program/Batch (never from the caller) — the same
    // trusted-relationship discipline every scope lookup in this codebase
    // already uses.
    const [modulesResult, sessionsResult] = await Promise.all([
      supabase
        .from("program_modules")
        .select("id, title")
        .eq("program_id", enrollment.program_id),
      enrollment.batch_id
        ? supabase
            .from("class_sessions")
            .select("id, session_date, topic")
            .eq("batch_id", enrollment.batch_id)
        : Promise.resolve({
            data: [] as Array<{ id: string; session_date: string; topic: string | null }>,
            error: null,
          }),
    ]);
    if (modulesResult.error) throw modulesResult.error;
    if (sessionsResult.error) throw sessionsResult.error;
    const modules = modulesResult.data ?? [];
    const sessions = sessionsResult.data ?? [];
    const moduleTitleById = new Map(modules.map((m) => [m.id, m.title]));
    const sessionLabelById = new Map(
      sessions.map((s) => [s.id, s.topic ?? s.session_date]),
    );

    const orParts = [`program_id.eq.${enrollment.program_id}`];
    if (enrollment.batch_id) orParts.push(`batch_id.eq.${enrollment.batch_id}`);

    const programBatchResult = await supabase
      .from("materials")
      .select(`${MATERIAL_COLUMNS}, program_id, batch_id`)
      .or(orParts.join(","));
    if (programBatchResult.error) throw programBatchResult.error;

    const moduleResult =
      modules.length > 0
        ? await supabase
            .from("materials")
            .select(`${MATERIAL_COLUMNS}, module_id`)
            .in(
              "module_id",
              modules.map((m) => m.id),
            )
        : { data: [], error: null };
    if (moduleResult.error) throw moduleResult.error;

    const sessionResult =
      sessions.length > 0
        ? await supabase
            .from("materials")
            .select(`${MATERIAL_COLUMNS}, class_session_id`)
            .in(
              "class_session_id",
              sessions.map((s) => s.id),
            )
        : { data: [], error: null };
    if (sessionResult.error) throw sessionResult.error;

    // One Material has exactly one scope (this phase's own one-scope-per-
    // material invariant — resolveExactlyOneScope), so a given id can only
    // ever match one of the three queries below; the Map is a harmless
    // safety net regardless.
    const seen = new Map<string, MaterialRow>();
    for (const row of (programBatchResult.data ?? []) as Array<
      MaterialQueryRow & { program_id: string | null; batch_id: string | null }
    >) {
      const label = row.program_id === enrollment.program_id ? "Program" : "Batch";
      seen.set(row.id, { ...toMaterialRow(row), scopeLabel: label });
    }
    for (const row of (moduleResult.data ?? []) as Array<
      MaterialQueryRow & { module_id: string }
    >) {
      const label = `Module: ${moduleTitleById.get(row.module_id) ?? ""}`;
      seen.set(row.id, { ...toMaterialRow(row), scopeLabel: label });
    }
    for (const row of (sessionResult.data ?? []) as Array<
      MaterialQueryRow & { class_session_id: string }
    >) {
      const label = `Session: ${sessionLabelById.get(row.class_session_id) ?? ""}`;
      seen.set(row.id, { ...toMaterialRow(row), scopeLabel: label });
    }

    return {
      ok: true,
      data: Array.from(seen.values()).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      ),
    };
  } catch (error) {
    return fail("Could not load materials.", error);
  }
}
