import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import type { ClassSessionStatus } from "@/lib/domain/class-sessions";
import type { ClassSessionInput } from "@/lib/validation/class-sessions";

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
