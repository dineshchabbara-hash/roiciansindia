import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";

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
