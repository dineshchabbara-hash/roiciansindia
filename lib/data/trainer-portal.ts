import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DataResult } from "@/lib/data/dashboard";
import type { ClassSessionStatus } from "@/lib/domain/class-sessions";
import type { ClassSessionInput } from "@/lib/validation/class-sessions";
import type { AttendanceStatus } from "@/lib/domain/attendance";
import type { AttendanceRosterEntry } from "@/lib/validation/attendance";
import type { MaterialScope } from "@/lib/domain/materials";
import type { CreateMaterialInput } from "@/lib/validation/materials";
import { createMaterialRecord } from "@/lib/data/materials";
import type {
  CreateAssignmentInput,
  ReviewSubmissionInput,
} from "@/lib/validation/assignments";
import {
  createAssignmentRecord,
  getAssignmentsForBatch,
  getSubmissionsForAssignment,
  reviewSubmission,
  updateAssignmentStatus,
  type AssignmentRow,
  type SubmissionRow,
} from "@/lib/data/assignments";
import type { AssignmentStatus } from "@/lib/domain/assignments";

/**
 * Trainer Portal data-access layer (Phase 11). Deliberately separate from
 * lib/data/trainers.ts / lib/data/students.ts / lib/data/enrollments.ts (the
 * Admin-facing modules) rather than reusing them: those accept an arbitrary
 * caller-supplied id (safe only because Admin RLS permits any row) and, for
 * Programs, would include this schema's own pricing columns
 * (regular_fee/registration_fee/tax_rate_percent) that REQUIREMENTS.md FR-54
 * explicitly forbids showing a Trainer. See the Phase 11 report for the
 * exact projection decisions.
 *
 * Every function below resolves "which trainer" from the caller's own
 * authenticated session (auth.getUser()) and filters by it directly in the
 * query — never from a caller-supplied id — the same defense-in-depth
 * pattern as lib/data/student-portal.ts (Phase 10), alongside this
 * project's RLS (trainers_select_own, batches_select_trainer,
 * batch_trainers_select_own — supabase/migrations/20260101000014_rls_
 * policies.sql) and the trainer_visible_students()/trainer_visible_
 * enrollments() SECURITY DEFINER functions (supabase/migrations/
 * 20260101000017_replace_trainer_views_with_hardened_functions.sql), which
 * are the only sanctioned read path to Student/Enrollment data at all for a
 * Trainer — the base `students`/`enrollments` tables carry no trainer-
 * matching RLS policy.
 */

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[trainer-portal data] ${message}:`, error);
  return { ok: false, error: message };
}

// ---------------------------------------------------------------------------
// Own profile — read-only. No REQUIREMENTS.md FR authorizes any Trainer
// self-edit (contrast FR-41 for Students), and there is no
// trainers_update_own RLS policy at all — only Admin/Super Admin may update
// a trainer row. Phase 11 therefore adds no update path here.

export type MyTrainerProfile = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  bio: string | null;
  specialization: string[];
  status: "active" | "inactive";
};

export async function getMyTrainerProfile(): Promise<DataResult<MyTrainerProfile>> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };

    const { data, error } = await supabase
      .from("trainers")
      .select("id, first_name, last_name, email, phone, bio, specialization, status")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: false, error: "Trainer profile not found." };

    return {
      ok: true,
      data: {
        id: data.id,
        firstName: data.first_name,
        lastName: data.last_name,
        email: data.email,
        phone: data.phone,
        bio: data.bio,
        specialization: data.specialization ?? [],
        status: data.status,
      },
    };
  } catch (error) {
    return fail("Could not load your profile.", error);
  }
}

async function resolveMyTrainerId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<DataResult<string>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("trainers")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "Trainer profile not found." };
  return { ok: true, data: data.id };
}

// ---------------------------------------------------------------------------
// Assigned batches — FR-50/FR-51 safe projection. Explicit column list on
// both `batches` and `programs`: never regular_fee/registration_fee/
// tax_rate_percent (programs) or any payment/finance field, even though
// programs_select_published's RLS would technically permit a Trainer to
// read any non-draft Program directly — this application-layer projection
// is the actual enforcement of "Trainer sees no financial fields",
// independent of that broader (pre-existing, unrelated-purpose) policy.

export type MyBatchRow = {
  id: string;
  name: string;
  programId: string;
  programCode: string;
  programName: string;
  startDate: string;
  expectedEndDate: string | null;
  startTime: string | null;
  endTime: string | null;
  daysOfWeek: string[];
  timezone: string;
  deliveryMode: string | null;
  capacity: number | null;
  status: string;
  meetingLink: string | null;
  location: string | null;
  isPrimary: boolean;
};

const BATCH_SELECT =
  "id, is_primary, batch:batches(id, name, program_id, start_date, expected_end_date, start_time, end_time, days_of_week, timezone, delivery_mode, capacity, status, meeting_link, location, program:programs(program_code, name))";

type BatchTrainerJoinRow = {
  is_primary: boolean;
  batch: {
    id: string;
    name: string;
    program_id: string;
    start_date: string;
    expected_end_date: string | null;
    start_time: string | null;
    end_time: string | null;
    days_of_week: string[];
    timezone: string;
    delivery_mode: string | null;
    capacity: number | null;
    status: string;
    meeting_link: string | null;
    location: string | null;
    program: { program_code: string; name: string } | null;
  } | null;
};

function toMyBatchRow(row: BatchTrainerJoinRow): MyBatchRow | null {
  if (!row.batch) return null;
  return {
    id: row.batch.id,
    name: row.batch.name,
    programId: row.batch.program_id,
    programCode: row.batch.program?.program_code ?? "—",
    programName: row.batch.program?.name ?? "Unknown program",
    startDate: row.batch.start_date,
    expectedEndDate: row.batch.expected_end_date,
    startTime: row.batch.start_time,
    endTime: row.batch.end_time,
    daysOfWeek: row.batch.days_of_week ?? [],
    timezone: row.batch.timezone,
    deliveryMode: row.batch.delivery_mode,
    capacity: row.batch.capacity,
    status: row.batch.status,
    meetingLink: row.batch.meeting_link,
    location: row.batch.location,
    isPrimary: row.is_primary,
  };
}

export async function getMyBatches(): Promise<DataResult<MyBatchRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const trainerId = await resolveMyTrainerId(supabase);
    if (!trainerId.ok) return trainerId;

    const { data, error } = await supabase
      .from("batch_trainers")
      .select(BATCH_SELECT)
      .eq("trainer_id", trainerId.data);
    if (error) throw error;

    const rows = ((data ?? []) as unknown as BatchTrainerJoinRow[])
      .map(toMyBatchRow)
      .filter((row): row is MyBatchRow => row !== null);

    return { ok: true, data: rows };
  } catch (error) {
    return fail("Could not load your assigned batches.", error);
  }
}

// Deliberately re-checks `trainer_id` against the caller's own resolved id
// (not just `batch_id`) — this is the exact query a direct-URL/ID-
// manipulation attempt against an unassigned batch must fail against (Phase
// 11 DoD). A mismatched id returns the same "not found" as a genuinely
// nonexistent batch, never a distinct "not yours" response.
export async function getMyBatch(batchId: string): Promise<DataResult<MyBatchRow>> {
  try {
    const supabase = await createSupabaseServerClient();
    const trainerId = await resolveMyTrainerId(supabase);
    if (!trainerId.ok) return trainerId;

    const { data, error } = await supabase
      .from("batch_trainers")
      .select(BATCH_SELECT)
      .eq("trainer_id", trainerId.data)
      .eq("batch_id", batchId)
      .maybeSingle();
    if (error) throw error;

    const row = toMyBatchRow((data ?? { batch: null }) as unknown as BatchTrainerJoinRow);
    if (!row) return { ok: false, error: "Batch not found." };
    return { ok: true, data: row };
  } catch (error) {
    return fail("Could not load this batch.", error);
  }
}

// ---------------------------------------------------------------------------
// Assigned programs — derived from the Trainer's own assigned batches only
// (never every published Program), safe projection (no fee columns at all).

export type MyProgramSummary = {
  id: string;
  programCode: string;
  name: string;
  description: string | null;
  category: string | null;
  durationValue: number | null;
  durationUnit: string | null;
  deliveryMode: string | null;
  status: string;
};

export async function getMyPrograms(): Promise<DataResult<MyProgramSummary[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const trainerId = await resolveMyTrainerId(supabase);
    if (!trainerId.ok) return trainerId;

    const { data: assignments, error: assignmentsError } = await supabase
      .from("batch_trainers")
      .select("batch:batches(program_id)")
      .eq("trainer_id", trainerId.data);
    if (assignmentsError) throw assignmentsError;

    const programIds = Array.from(
      new Set(
        (
          (assignments ?? []) as unknown as Array<{
            batch: { program_id: string } | null;
          }>
        )
          .map((row) => row.batch?.program_id)
          .filter((id): id is string => !!id),
      ),
    );
    if (programIds.length === 0) return { ok: true, data: [] };

    const { data, error } = await supabase
      .from("programs")
      .select(
        "id, program_code, name, description, category, duration_value, duration_unit, delivery_mode, status",
      )
      .in("id", programIds);
    if (error) throw error;

    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        programCode: row.program_code,
        name: row.name,
        description: row.description,
        category: row.category,
        durationValue: row.duration_value,
        durationUnit: row.duration_unit,
        deliveryMode: row.delivery_mode,
        status: row.status,
      })),
    };
  } catch (error) {
    return fail("Could not load your assigned programs.", error);
  }
}

// ---------------------------------------------------------------------------
// Assigned students — the ONLY sanctioned read path (see this file's own
// header comment): trainer_visible_students(), a SECURITY DEFINER function
// already scoped to the calling Trainer's own assigned batches and already
// excluding every address/DOB/emergency-contact/financial column. This
// module never queries the base `students`/`enrollments` tables directly.

export type MyStudentRow = {
  studentId: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  batchId: string;
};

type TrainerVisibleStudentRpcRow = {
  student_id: string;
  student_code: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  batch_id: string;
};

async function callTrainerVisibleStudents(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<DataResult<MyStudentRow[]>> {
  const { data, error } = await supabase.rpc("trainer_visible_students");
  if (error) throw error;

  return {
    ok: true,
    data: ((data ?? []) as TrainerVisibleStudentRpcRow[]).map((row) => ({
      studentId: row.student_id,
      studentCode: row.student_code,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
      email: row.email,
      batchId: row.batch_id,
    })),
  };
}

export async function getMyStudents(): Promise<DataResult<MyStudentRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    return await callTrainerVisibleStudents(supabase);
  } catch (error) {
    return fail("Could not load your assigned students.", error);
  }
}

export async function getMyStudentsForBatch(
  batchId: string,
): Promise<DataResult<MyStudentRow[]>> {
  const result = await getMyStudents();
  if (!result.ok) return result;
  return { ok: true, data: result.data.filter((row) => row.batchId === batchId) };
}

// Filters the same trainer-scoped RPC result down to one student id, rather
// than a separate query — the RPC has already applied the only ownership
// boundary that exists for Student data from a Trainer's perspective, so a
// requested id absent from it is indistinguishable from nonexistent (Phase
// 11 DoD: a guessed Student ID must not bypass scope).
export async function getMyStudent(studentId: string): Promise<DataResult<MyStudentRow>> {
  const result = await getMyStudents();
  if (!result.ok) return result;
  const row = result.data.find((student) => student.studentId === studentId);
  if (!row) return { ok: false, error: "Student not found." };
  return { ok: true, data: row };
}

// ---------------------------------------------------------------------------
// Class Sessions (Phase 12) — FR-60/IMPLEMENTATION_PLAN.md Phase 12 scope
// ("Trainer create/edit for assigned batches"), already backed by
// pre-existing RLS (class_sessions_select_trainer/write_trainer/
// update_trainer, 20260101000014_rls_policies.sql — unchanged by Phase 12,
// scoped via batch_trainers to current_trainer_id()). Every function below
// still independently re-verifies the batch is actually one of the caller's
// own assignments via getMyBatch before touching class_sessions, the same
// defense-in-depth already established for Batches/Students above — RLS is
// the backstop, not the only check. There is no Trainer delete capability:
// no class_sessions_delete_trainer policy exists, by design (see the Phase
// 12 report).

export type MyClassSessionRow = {
  id: string;
  batchId: string;
  trainerId: string | null;
  trainerName: string | null;
  sessionDate: string;
  startTime: string | null;
  endTime: string | null;
  topic: string | null;
  description: string | null;
  meetingLink: string | null;
  status: ClassSessionStatus;
  notes: string | null;
};

const CLASS_SESSION_SELECT =
  "id, batch_id, trainer_id, session_date, start_time, end_time, topic, description, meeting_link, status, notes, trainer:trainers(first_name, last_name)";

type ClassSessionJoinRow = {
  id: string;
  batch_id: string;
  trainer_id: string | null;
  session_date: string;
  start_time: string | null;
  end_time: string | null;
  topic: string | null;
  description: string | null;
  meeting_link: string | null;
  status: ClassSessionStatus;
  notes: string | null;
  trainer: { first_name: string; last_name: string } | null;
};

function toMyClassSessionRow(row: ClassSessionJoinRow): MyClassSessionRow {
  return {
    id: row.id,
    batchId: row.batch_id,
    trainerId: row.trainer_id,
    trainerName: row.trainer
      ? `${row.trainer.first_name} ${row.trainer.last_name}`
      : null,
    sessionDate: row.session_date,
    startTime: row.start_time,
    endTime: row.end_time,
    topic: row.topic,
    description: row.description,
    meetingLink: row.meeting_link,
    status: row.status,
    notes: row.notes,
  };
}

export async function getMySessionsForBatch(
  batchId: string,
): Promise<DataResult<MyClassSessionRow[]>> {
  const batch = await getMyBatch(batchId);
  if (!batch.ok) return batch;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("class_sessions")
      .select(CLASS_SESSION_SELECT)
      .eq("batch_id", batchId)
      .order("session_date", { ascending: true })
      .order("start_time", { ascending: true });
    if (error) throw error;

    return {
      ok: true,
      data: ((data ?? []) as unknown as ClassSessionJoinRow[]).map(toMyClassSessionRow),
    };
  } catch (error) {
    return fail("Could not load class sessions for this batch.", error);
  }
}

// Scoped by batch ownership (getMyBatch) AND the session's own batch_id —
// an unassigned batch id, a nonexistent session id, or a genuine session
// that belongs to a DIFFERENT batch than the [id] segment all 404
// identically, the same guarantee as getMyBatch/getMyStudent above.
export async function getMySession(
  batchId: string,
  sessionId: string,
): Promise<DataResult<MyClassSessionRow>> {
  const batch = await getMyBatch(batchId);
  if (!batch.ok) return batch;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("class_sessions")
      .select(CLASS_SESSION_SELECT)
      .eq("id", sessionId)
      .eq("batch_id", batchId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "Class session not found." };

    return {
      ok: true,
      data: toMyClassSessionRow(data as unknown as ClassSessionJoinRow),
    };
  } catch (error) {
    return fail("Could not load this class session.", error);
  }
}

export async function createMyClassSession(
  batchId: string,
  input: ClassSessionInput,
): Promise<DataResult<{ id: string }>> {
  const batch = await getMyBatch(batchId);
  if (!batch.ok) return batch;

  try {
    const supabase = await createSupabaseServerClient();
    const trainerId = await resolveMyTrainerId(supabase);
    if (!trainerId.ok) return trainerId;

    const { data, error } = await supabase
      .from("class_sessions")
      .insert({
        batch_id: batchId,
        // Always the caller's own resolved trainer id — never a value the
        // browser could submit — so a Trainer can never attribute a session
        // to a different Trainer.
        trainer_id: trainerId.data,
        session_date: input.sessionDate,
        start_time: input.startTime,
        end_time: input.endTime,
        topic: input.topic,
        description: input.description,
        meeting_link: input.meetingLink,
        notes: input.notes,
      })
      .select("id")
      .single();

    if (error) throw error;
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail("Could not create the class session. Please try again.", error);
  }
}

export async function updateMyClassSession(
  batchId: string,
  sessionId: string,
  input: ClassSessionInput,
): Promise<DataResult<null>> {
  const session = await getMySession(batchId, sessionId);
  if (!session.ok) return session;

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("class_sessions")
      .update({
        session_date: input.sessionDate,
        start_time: input.startTime,
        end_time: input.endTime,
        topic: input.topic,
        description: input.description,
        meeting_link: input.meetingLink,
        notes: input.notes,
      })
      .eq("id", sessionId)
      .eq("batch_id", batchId);

    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not save changes. Please try again.", error);
  }
}

export async function updateMyClassSessionStatus(
  batchId: string,
  sessionId: string,
  status: ClassSessionStatus,
): Promise<DataResult<null>> {
  const session = await getMySession(batchId, sessionId);
  if (!session.ok) return session;

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("class_sessions")
      .update({ status })
      .eq("id", sessionId)
      .eq("batch_id", batchId);

    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not update the session's status. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Trainer dashboard "Upcoming classes" widget (IMPLEMENTATION_PLAN.md Phase
// 12 — "closing the placeholders from Phases 4/10/11"). Relies entirely on
// class_sessions_select_trainer RLS to scope rows to the caller's own
// assigned batches — the same minimal-query pattern as lib/data/dashboard.ts's
// Admin-facing getUpcomingClassSessions, just under RLS as a Trainer rather
// than is_admin_or_super().

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
// Attendance (Phase 13 — REQUIREMENTS.md FR-52/61/62/63,
// IMPLEMENTATION_PLAN.md Phase 13). Backed by pre-existing RLS
// (attendance_select_trainer/write_trainer/update_trainer — scoped via
// batch_trainers to current_trainer_id(), 20260101000014_rls_policies.sql)
// unchanged by this phase. getMySession above already re-verifies the
// batch+session relationship and the caller's own assignment to it; every
// function below calls it first, the same defense-in-depth already
// established for Batches/Students/Class Sessions in this file.
//
// The eligible roster comes from trainer_visible_enrollments()/
// trainer_visible_students() — the ONLY sanctioned read path to
// Student/Enrollment data for a Trainer (this file's own header comment) —
// filtered in application code to this session's own batch, never from a
// caller-supplied student/enrollment id. There is no Trainer delete
// capability: no attendance_delete_trainer policy exists, by design.
//
// attendance_audit has NO trainer RLS policy at all (only
// attendance_audit_select_admin/write_admin exist) — a Trainer correcting
// their own prior mark cannot write that table under their own session, by
// design (defense in depth: a Trainer can update `attendance` itself, which
// RLS genuinely authorizes via attendance_update_trainer, but cannot touch
// the audit history of it directly). The actual `attendance` mutation below
// still goes through the Trainer's own RLS-scoped client — RLS is still the
// real authorization gate — and only the resulting attendance_audit insert
// uses the service-role client, exactly the same narrow, write-only,
// after-the-fact pattern lib/data/audit-log.ts's writeAuditLog() already
// uses for the general audit trail.

export type MyAttendanceRosterRow = {
  enrollmentId: string;
  studentId: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  attendanceId: string | null;
  status: AttendanceStatus | null;
  notes: string | null;
  markedAt: string | null;
};

export async function getMyEligibleRosterForSession(
  batchId: string,
  sessionId: string,
): Promise<DataResult<MyAttendanceRosterRow[]>> {
  const session = await getMySession(batchId, sessionId);
  if (!session.ok) return session;

  try {
    const supabase = await createSupabaseServerClient();

    const enrollments = await supabase.rpc("trainer_visible_enrollments");
    if (enrollments.error) throw enrollments.error;
    const students = await supabase.rpc("trainer_visible_students");
    if (students.error) throw students.error;

    type VisibleEnrollmentRow = {
      enrollment_id: string;
      student_id: string;
      batch_id: string;
    };
    type VisibleStudentRow = {
      student_id: string;
      student_code: string;
      first_name: string;
      last_name: string;
      batch_id: string;
    };

    const studentById = new Map(
      (students.data as VisibleStudentRow[])
        .filter((row) => row.batch_id === batchId)
        .map((row) => [row.student_id, row]),
    );

    const { data: existing, error: existingError } = await supabase
      .from("attendance")
      .select("id, enrollment_id, status, notes, marked_at")
      .eq("class_session_id", sessionId);
    if (existingError) throw existingError;
    const existingByEnrollment = new Map(
      (
        (existing ?? []) as Array<{
          id: string;
          enrollment_id: string;
          status: AttendanceStatus;
          notes: string | null;
          marked_at: string;
        }>
      ).map((row) => [row.enrollment_id, row]),
    );

    const roster: MyAttendanceRosterRow[] = [];
    for (const row of enrollments.data as VisibleEnrollmentRow[]) {
      if (row.batch_id !== batchId) continue;
      const student = studentById.get(row.student_id);
      if (!student) continue;

      const existingRow = existingByEnrollment.get(row.enrollment_id);
      roster.push({
        enrollmentId: row.enrollment_id,
        studentId: student.student_id,
        studentCode: student.student_code,
        firstName: student.first_name,
        lastName: student.last_name,
        attendanceId: existingRow?.id ?? null,
        status: existingRow?.status ?? null,
        notes: existingRow?.notes ?? null,
        markedAt: existingRow?.marked_at ?? null,
      });
    }
    roster.sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
    );

    return { ok: true, data: roster };
  } catch (error) {
    return fail("Could not load the attendance roster for this class session.", error);
  }
}

export type MyAttendanceMarkResult = {
  marked: number;
  corrected: number;
  ignored: number;
};

async function upsertOneMyAttendanceRow(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: {
    sessionId: string;
    batchId: string;
    studentId: string;
    entry: AttendanceRosterEntry;
    existing: { id: string; status: AttendanceStatus; notes: string | null } | undefined;
    trainerId: string;
  },
): Promise<DataResult<"marked" | "corrected" | "unchanged">> {
  const { sessionId, batchId, studentId, entry, existing, trainerId } = params;
  const newNotes = entry.notes ?? null;

  if (!existing) {
    const { error } = await supabase.from("attendance").insert({
      class_session_id: sessionId,
      enrollment_id: entry.enrollmentId,
      student_id: studentId,
      batch_id: batchId,
      status: entry.status,
      marked_by: trainerId,
      marked_by_type: "trainer",
      notes: newNotes,
    });
    if (!error) return { ok: true, data: "marked" };
    if ((error as { code?: string }).code !== "23505") {
      return { ok: false, error: `Could not mark attendance: ${error.message}` };
    }
  }

  const { data: beforeRow, error: beforeError } = await supabase
    .from("attendance")
    .select("id, status, notes")
    .eq("class_session_id", sessionId)
    .eq("enrollment_id", entry.enrollmentId)
    .maybeSingle();
  if (beforeError)
    return {
      ok: false,
      error: `Could not load the existing mark: ${beforeError.message}`,
    };
  if (!beforeRow)
    return { ok: false, error: "Attendance row disappeared mid-correction." };

  const statusChanged = beforeRow.status !== entry.status;
  const notesChanged = (beforeRow.notes ?? null) !== newNotes;
  if (!statusChanged && !notesChanged) return { ok: true, data: "unchanged" };

  const { error: updateError } = await supabase
    .from("attendance")
    .update({
      status: entry.status,
      notes: newNotes,
      marked_by: trainerId,
      marked_by_type: "trainer",
      marked_at: new Date().toISOString(),
    })
    .eq("id", beforeRow.id);
  if (updateError)
    return { ok: false, error: `Could not correct attendance: ${updateError.message}` };

  if (statusChanged) {
    // No attendance_audit RLS policy exists for Trainer — service role is
    // required for this one insert only, after the real RLS-authorized
    // update above already succeeded. See this section's own header comment.
    const adminClient = createSupabaseAdminClient();
    const { error: auditError } = await adminClient.from("attendance_audit").insert({
      attendance_id: beforeRow.id,
      changed_by: trainerId,
      changed_by_type: "trainer",
      previous_status: beforeRow.status,
      new_status: entry.status,
    });
    if (auditError) {
      return {
        ok: false,
        error: `Could not record the attendance change history: ${auditError.message}`,
      };
    }
  }

  return { ok: true, data: "corrected" };
}

export async function markMyAttendanceForSession(
  batchId: string,
  sessionId: string,
  entries: AttendanceRosterEntry[],
): Promise<DataResult<MyAttendanceMarkResult>> {
  const session = await getMySession(batchId, sessionId);
  if (!session.ok) return session;

  const selected = entries.filter((entry) => entry.status !== undefined);
  if (selected.length === 0)
    return { ok: true, data: { marked: 0, corrected: 0, ignored: 0 } };

  try {
    const supabase = await createSupabaseServerClient();
    const trainerId = await resolveMyTrainerId(supabase);
    if (!trainerId.ok) return trainerId;

    const enrollments = await supabase.rpc("trainer_visible_enrollments");
    if (enrollments.error) throw enrollments.error;
    type VisibleEnrollmentRow = {
      enrollment_id: string;
      student_id: string;
      batch_id: string;
    };
    const studentIdByEnrollment = new Map(
      (enrollments.data as VisibleEnrollmentRow[])
        .filter((row) => row.batch_id === batchId)
        .map((row) => [row.enrollment_id, row.student_id]),
    );

    const { data: existingRows, error: existingError } = await supabase
      .from("attendance")
      .select("id, enrollment_id, status, notes")
      .eq("class_session_id", sessionId);
    if (existingError) throw existingError;
    const existingByEnrollment = new Map(
      (
        (existingRows ?? []) as Array<{
          id: string;
          enrollment_id: string;
          status: AttendanceStatus;
          notes: string | null;
        }>
      ).map((row) => [
        row.enrollment_id,
        { id: row.id, status: row.status, notes: row.notes },
      ]),
    );

    const result: MyAttendanceMarkResult = { marked: 0, corrected: 0, ignored: 0 };
    for (const entry of selected) {
      const studentId = studentIdByEnrollment.get(entry.enrollmentId);
      if (!studentId) {
        result.ignored += 1;
        continue;
      }

      const outcome = await upsertOneMyAttendanceRow(supabase, {
        sessionId,
        batchId,
        studentId,
        entry,
        existing: existingByEnrollment.get(entry.enrollmentId),
        trainerId: trainerId.data,
      });
      if (!outcome.ok) return outcome;
      if (outcome.data === "marked") result.marked += 1;
      else if (outcome.data === "corrected") result.corrected += 1;
    }

    return { ok: true, data: result };
  } catch (error) {
    return fail("Could not save attendance. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Materials (Phase 15) — Trainer upload only, Batch/Session scope only.
// materials_write_trainer RLS (supabase/migrations/20260101000014_rls_
// policies.sql) has no program/module branch at all, matching
// batch_trainers being the only Trainer assignment model this codebase
// has — a Trainer is never authorized to manage Program- or Module-level
// materials, and this function never offers that path, not merely hides
// it. getMyBatch/getMySession below re-verify assignment before any write
// (defense in depth; Storage/table RLS enforce the same boundary
// independently either way).

export async function createMyMaterial(
  scope:
    | { type: "batch"; batchId: string }
    | { type: "session"; batchId: string; sessionId: string },
  data: CreateMaterialInput,
  file: File | null,
): Promise<DataResult<{ id: string }>> {
  if (scope.type === "batch") {
    const batch = await getMyBatch(scope.batchId);
    if (!batch.ok) return batch;
  } else {
    const session = await getMySession(scope.batchId, scope.sessionId);
    if (!session.ok) return session;
  }

  try {
    const supabase = await createSupabaseServerClient();
    // materials.uploaded_by has no FK constraint, but the project's own
    // existing precedent for this exact column shape — student_documents.
    // uploaded_by/uploaded_by_type (DATABASE_SCHEMA.md §4, same "uuid not
    // null" + role-check-constraint pairing) — is populated with the
    // caller's role-specific profile id (lib/actions/students.ts passes
    // ctx.profileId, i.e. admins.id, to uploadStudentDocument), never the
    // raw auth_user_id. Materials follows that same established contract:
    // uploaded_by is the trainers.id row, resolved the same way every
    // other Trainer-scoped function in this file already does.
    const trainerId = await resolveMyTrainerId(supabase);
    if (!trainerId.ok) return trainerId;

    const materialScope: MaterialScope =
      scope.type === "batch"
        ? { type: "batch", id: scope.batchId }
        : { type: "session", id: scope.sessionId };

    return await createMaterialRecord({
      scope: materialScope,
      data,
      file,
      uploadedBy: trainerId.data,
      uploadedByType: "trainer",
    });
  } catch (error) {
    return fail("Could not create the material. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Assignments & Submissions (Phase 16) — Trainer create/manage scoped to
// assigned Batches only, matching assignments_write_trainer/_update_trainer
// RLS exactly (both join through batch_trainers, no program/module branch
// of their own — a Trainer is never authorized to create an assignment for
// a batch they are not assigned to, and this module never offers that
// path, not merely hides it). getMyBatch below re-verifies assignment
// before any write (defense in depth; table/Storage RLS enforce the same
// boundary independently either way).

export async function getMyAssignmentsForBatch(
  batchId: string,
): Promise<DataResult<AssignmentRow[]>> {
  const batch = await getMyBatch(batchId);
  if (!batch.ok) return batch;
  return getAssignmentsForBatch(batchId);
}

// Scoped by batch ownership (getMyBatch) AND the assignment's own batch_id
// — an unassigned batch id, a nonexistent assignment id, or a genuine
// assignment that belongs to a DIFFERENT batch than the [id] segment all
// come back "not found" identically, the same guarantee as getMySession.
export async function getMyAssignment(
  batchId: string,
  assignmentId: string,
): Promise<DataResult<AssignmentRow>> {
  const batch = await getMyBatch(batchId);
  if (!batch.ok) return batch;

  const result = await getAssignmentsForBatch(batchId);
  if (!result.ok) return result;
  const row = result.data.find((a) => a.id === assignmentId);
  if (!row) return { ok: false, error: "Assignment not found." };
  return { ok: true, data: row };
}

export async function createMyAssignment(
  batchId: string,
  data: CreateAssignmentInput,
  file: File | null,
): Promise<DataResult<{ id: string }>> {
  const batch = await getMyBatch(batchId);
  if (!batch.ok) return batch;

  try {
    const supabase = await createSupabaseServerClient();
    const trainerId = await resolveMyTrainerId(supabase);
    if (!trainerId.ok) return trainerId;

    return await createAssignmentRecord({
      programId: batch.data.programId,
      batchId,
      // Always the caller's own resolved trainer id — never a value the
      // browser could submit — so a Trainer can never attribute an
      // assignment to a different Trainer, the same discipline
      // createMyClassSession already uses for trainer_id.
      trainerId: trainerId.data,
      data,
      file,
    });
  } catch (error) {
    return fail("Could not create the assignment. Please try again.", error);
  }
}

export async function updateMyAssignmentStatus(
  batchId: string,
  assignmentId: string,
  status: AssignmentStatus,
): Promise<DataResult<null>> {
  const assignment = await getMyAssignment(batchId, assignmentId);
  if (!assignment.ok) return assignment;
  return updateAssignmentStatus(assignmentId, status);
}

export async function getMySubmissionsForAssignment(
  batchId: string,
  assignmentId: string,
): Promise<DataResult<SubmissionRow[]>> {
  const assignment = await getMyAssignment(batchId, assignmentId);
  if (!assignment.ok) return assignment;
  return getSubmissionsForAssignment(assignmentId);
}

export async function reviewMySubmission(
  batchId: string,
  assignmentId: string,
  submissionId: string,
  input: ReviewSubmissionInput,
): Promise<DataResult<null>> {
  const assignment = await getMyAssignment(batchId, assignmentId);
  if (!assignment.ok) return assignment;

  try {
    const supabase = await createSupabaseServerClient();
    const trainerId = await resolveMyTrainerId(supabase);
    if (!trainerId.ok) return trainerId;

    // Re-verify the submission itself actually belongs to this exact
    // assignment — a submissionId for a different assignment (even one
    // this same Trainer is otherwise authorized to review) must not be
    // reachable through this assignment's own review action.
    const submissions = await getSubmissionsForAssignment(assignmentId);
    if (!submissions.ok) return submissions;
    if (!submissions.data.some((s) => s.id === submissionId)) {
      return { ok: false, error: "Submission not found." };
    }

    return await reviewSubmission({
      submissionId,
      marks: input.marks,
      trainerFeedback: input.trainerFeedback,
      nextStatus: input.nextStatus,
      reviewerTrainerId: trainerId.data,
    });
  } catch (error) {
    return fail("Could not save the review. Please try again.", error);
  }
}
