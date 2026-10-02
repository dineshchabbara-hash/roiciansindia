import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import { getClassSession } from "@/lib/data/class-sessions";
import type { AttendanceStatus, AttendanceMarkedByType } from "@/lib/domain/attendance";
import type { AttendanceRosterEntry } from "@/lib/validation/attendance";

/**
 * Admin-facing Attendance data layer (Phase 13 — REQUIREMENTS.md
 * FR-61/62/63, IMPLEMENTATION_PLAN.md Phase 13). The `attendance`/
 * `attendance_audit` tables and their RLS policies (attendance_select_admin/
 * write_admin/update_admin/delete_admin, attendance_audit_select_admin/
 * write_admin — supabase/migrations/20260101000014_rls_policies.sql) are
 * pre-existing and unchanged by this phase; this module is the first
 * application code to exercise them, the same situation Phase 12 was in for
 * class_sessions.
 *
 * Caller-supplied batch/session ids are trusted the same way
 * lib/data/class-sessions.ts trusts them: Admin/Super Admin RLS grants full
 * access regardless of id, and every caller independently re-checks
 * isAdminOrSuperAdmin() before calling in (lib/actions/attendance.ts).
 * Eligibility is re-derived from `enrollments.batch_id` on every read AND
 * every mutation — never from a caller-supplied enrollment/student id alone
 * (see markAttendanceForClassSession's own comment).
 *
 * No hard-delete control is exposed here even though attendance_delete_admin
 * exists at the RLS layer — same precedent as Phase 12's class_sessions
 * (status-based correction is the approved path; see the Phase 13 report).
 */

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[attendance data] ${message}:`, error);
  return { ok: false, error: message };
}

export type AttendanceRosterRow = {
  enrollmentId: string;
  studentId: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  enrollmentStatus: string;
  attendanceId: string | null;
  status: AttendanceStatus | null;
  notes: string | null;
  markedAt: string | null;
};

export type AttendanceSessionContext = {
  classSessionId: string;
  batchId: string;
  sessionDate: string;
  topic: string | null;
  status: string;
};

type EnrollmentRosterJoinRow = {
  id: string;
  status: string;
  student: {
    id: string;
    student_code: string;
    first_name: string;
    last_name: string;
  } | null;
};

type AttendanceExistingRow = {
  id: string;
  enrollment_id: string;
  status: AttendanceStatus;
  notes: string | null;
  marked_at: string;
};

// Scoped by BOTH the session id and its expected batch id, via
// getClassSession — the same direct-URL/ID-manipulation defense Phase 12
// established: a [id]/[sessionId] pair that don't actually belong together
// 404s identically to a nonexistent session.
export async function getEligibleRosterForClassSession(
  batchId: string,
  sessionId: string,
): Promise<
  DataResult<{ session: AttendanceSessionContext; roster: AttendanceRosterRow[] }>
> {
  const session = await getClassSession(batchId, sessionId);
  if (!session.ok) return session;

  try {
    const supabase = await createSupabaseServerClient();

    // Eligibility: any enrollment tied to this session's own batch
    // (REQUIREMENTS.md FR-61's Student+Enrollment+Batch+Class Session
    // relationship) — never filtered by enrollment status. No FR defines an
    // exclusion list for attendance eligibility, and the Trainer-facing
    // equivalent of this same roster (trainer_visible_enrollments(),
    // 20260101000017_replace_trainer_views_with_hardened_functions.sql)
    // applies the identical "any enrollment in the batch" rule with no
    // status filter — inventing a stricter one here would be a new,
    // un-approved business rule, not a conservative default.
    const { data: enrollments, error: enrollmentsError } = await supabase
      .from("enrollments")
      .select("id, status, student:students(id, student_code, first_name, last_name)")
      .eq("batch_id", batchId);
    if (enrollmentsError) throw enrollmentsError;

    const { data: existing, error: existingError } = await supabase
      .from("attendance")
      .select("id, enrollment_id, status, notes, marked_at")
      .eq("class_session_id", sessionId);
    if (existingError) throw existingError;

    const existingByEnrollment = new Map(
      ((existing ?? []) as AttendanceExistingRow[]).map((row) => [
        row.enrollment_id,
        row,
      ]),
    );

    const roster: AttendanceRosterRow[] = (
      (enrollments ?? []) as unknown as EnrollmentRosterJoinRow[]
    )
      .filter(
        (
          row,
        ): row is EnrollmentRosterJoinRow & {
          student: NonNullable<EnrollmentRosterJoinRow["student"]>;
        } => row.student !== null,
      )
      .map((row) => {
        const existingRow = existingByEnrollment.get(row.id);
        return {
          enrollmentId: row.id,
          studentId: row.student.id,
          studentCode: row.student.student_code,
          firstName: row.student.first_name,
          lastName: row.student.last_name,
          enrollmentStatus: row.status,
          attendanceId: existingRow?.id ?? null,
          status: existingRow?.status ?? null,
          notes: existingRow?.notes ?? null,
          markedAt: existingRow?.marked_at ?? null,
        };
      })
      .sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
      );

    return {
      ok: true,
      data: {
        session: {
          classSessionId: sessionId,
          batchId,
          sessionDate: session.data.sessionDate,
          topic: session.data.topic,
          status: session.data.status,
        },
        roster,
      },
    };
  } catch (error) {
    return fail("Could not load the attendance roster for this class session.", error);
  }
}

export type AttendanceMarkResult = { marked: number; corrected: number; ignored: number };

// Inserts a fresh attendance row for an entry with no prior mark (no audit
// row — FR-63 scopes the audit trail to "changes AFTER initial marking"),
// or updates + writes an attendance_audit row for an entry that already has
// one (the correction path). Every enrollmentId processed here has already
// been cross-checked against this session's own batch in the caller below —
// never trusted on its own.
async function upsertOneAttendanceRow(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: {
    sessionId: string;
    batchId: string;
    studentId: string;
    entry: AttendanceRosterEntry;
    existing: { id: string; status: AttendanceStatus; notes: string | null } | undefined;
    actorId: string;
    actorType: AttendanceMarkedByType;
  },
): Promise<DataResult<"marked" | "corrected" | "unchanged">> {
  const { sessionId, batchId, studentId, entry, existing, actorId, actorType } = params;
  const newNotes = entry.notes ?? null;

  if (!existing) {
    const { error } = await supabase.from("attendance").insert({
      class_session_id: sessionId,
      enrollment_id: entry.enrollmentId,
      student_id: studentId,
      batch_id: batchId,
      status: entry.status,
      marked_by: actorId,
      marked_by_type: actorType,
      notes: newNotes,
    });
    if (!error) return { ok: true, data: "marked" };
    // Lost a race with a concurrent mark of the same student for the same
    // session (attendance_unique_per_session) — fall through to the
    // correction path below instead of failing the whole roster submission.
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
      marked_by: actorId,
      marked_by_type: actorType,
      marked_at: new Date().toISOString(),
    })
    .eq("id", beforeRow.id);
  if (updateError)
    return { ok: false, error: `Could not correct attendance: ${updateError.message}` };

  // attendance_audit (FR-63) tracks STATUS transitions specifically (its own
  // schema has no notes column) — a notes-only correction updates the row
  // above but writes no audit entry, matching what the table can actually
  // represent rather than forcing a previous_status===new_status row into it.
  if (statusChanged) {
    const { error: auditError } = await supabase.from("attendance_audit").insert({
      attendance_id: beforeRow.id,
      changed_by: actorId,
      changed_by_type: actorType,
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

// Server-side re-derivation of eligibility is the actual security boundary
// here (REQUIREMENTS.md §5 of the Phase 13 brief): the submitted
// enrollmentId list is intersected against this session's own batch's real
// enrollments before anything is written, so an enrollmentId for a
// different batch is silently ignored (counted, never acted on) rather than
// trusted. student_id/batch_id written to `attendance` always come from this
// server-side lookup, never from the form.
export async function markAttendanceForClassSession(
  batchId: string,
  sessionId: string,
  entries: AttendanceRosterEntry[],
  actor: { id: string; type: AttendanceMarkedByType },
): Promise<DataResult<AttendanceMarkResult>> {
  const session = await getClassSession(batchId, sessionId);
  if (!session.ok) return session;

  const selected = entries.filter((entry) => entry.status !== undefined);
  if (selected.length === 0)
    return { ok: true, data: { marked: 0, corrected: 0, ignored: 0 } };

  try {
    const supabase = await createSupabaseServerClient();

    const { data: eligibleRows, error: eligibleError } = await supabase
      .from("enrollments")
      .select("id, student_id")
      .eq("batch_id", batchId)
      .in(
        "id",
        selected.map((entry) => entry.enrollmentId),
      );
    if (eligibleError) throw eligibleError;
    const studentIdByEnrollment = new Map(
      ((eligibleRows ?? []) as Array<{ id: string; student_id: string }>).map((row) => [
        row.id,
        row.student_id,
      ]),
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

    const result: AttendanceMarkResult = { marked: 0, corrected: 0, ignored: 0 };
    for (const entry of selected) {
      const studentId = studentIdByEnrollment.get(entry.enrollmentId);
      if (!studentId) {
        result.ignored += 1;
        continue;
      }

      const outcome = await upsertOneAttendanceRow(supabase, {
        sessionId,
        batchId,
        studentId,
        entry,
        existing: existingByEnrollment.get(entry.enrollmentId),
        actorId: actor.id,
        actorType: actor.type,
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
