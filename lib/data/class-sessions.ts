import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import type { ClassSessionStatus } from "@/lib/domain/class-sessions";
import type { ClassSessionInput } from "@/lib/validation/class-sessions";

/**
 * Admin-facing Class Session data layer (Phase 12). The caller-supplied
 * batch/session ids here are trusted the same way lib/data/batches.ts trusts
 * them — Admin/Super Admin RLS (class_sessions_select_admin/write_admin/
 * update_admin/delete_admin, supabase/migrations/20260101000014_rls_
 * policies.sql, pre-existing and unchanged by Phase 12) grants full access
 * regardless of id, and every caller of this module independently re-checks
 * isAdminOrSuperAdmin() before calling in (lib/actions/class-sessions.ts).
 *
 * Trainer-facing reads/writes are a SEPARATE module (lib/data/trainer-
 * portal.ts's getMy*ClassSession* functions) that resolves "which trainer"
 * from the caller's own session and never accepts a trusted caller-supplied
 * id — the same separation Phase 11 established between this file's admin
 * siblings (trainers.ts/students.ts/enrollments.ts) and trainer-portal.ts.
 */

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[class-sessions data] ${message}:`, error);
  return { ok: false, error: message };
}

export type ClassSessionRow = {
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
  createdAt: string;
};

const CLASS_SESSION_SELECT =
  "id, batch_id, trainer_id, session_date, start_time, end_time, topic, description, meeting_link, status, notes, created_at, trainer:trainers(first_name, last_name)";

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
  created_at: string;
  trainer: { first_name: string; last_name: string } | null;
};

function toClassSessionRow(row: ClassSessionJoinRow): ClassSessionRow {
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
    createdAt: row.created_at,
  };
}

export async function getClassSessionsForBatch(
  batchId: string,
): Promise<DataResult<ClassSessionRow[]>> {
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
      data: ((data ?? []) as unknown as ClassSessionJoinRow[]).map(toClassSessionRow),
    };
  } catch (error) {
    return fail("Could not load class sessions for this batch.", error);
  }
}

// Scoped by BOTH the session id and its expected batch id — a route whose
// [id] (batch) and [sessionId] segments don't actually belong together must
// 404 identically to a nonexistent session, the same direct-URL/ID-
// manipulation defense established in Phase 10/11 (getMyEnrollment/
// getMyBatch), applied here for Admin too even though Admin RLS would permit
// reading the session regardless of which batch route it's nested under.
export async function getClassSession(
  batchId: string,
  sessionId: string,
): Promise<DataResult<ClassSessionRow>> {
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
    return { ok: true, data: toClassSessionRow(data as unknown as ClassSessionJoinRow) };
  } catch (error) {
    return fail("Could not load this class session.", error);
  }
}

export async function createClassSession(
  batchId: string,
  input: ClassSessionInput,
): Promise<DataResult<{ id: string }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("class_sessions")
      .insert({
        batch_id: batchId,
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

    if (error) {
      if ((error as { code?: string }).code === "23503") {
        return { ok: false, error: "Selected batch could not be found." };
      }
      throw error;
    }
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail("Could not create the class session. Please try again.", error);
  }
}

// batch_id/trainer_id are intentionally never included in this update —
// reassigning a session to a different batch has no documented business
// rule (same reasoning as lib/data/batches.ts never exposing Program
// reassignment), and trainer_id is system-derived at creation only (see the
// Phase 12 report for why no trainer-picker UI exists in Phase 12).
export async function updateClassSession(
  sessionId: string,
  input: ClassSessionInput,
): Promise<DataResult<null>> {
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
      .eq("id", sessionId);

    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not save changes. Please try again.", error);
  }
}

export async function updateClassSessionStatus(
  sessionId: string,
  status: ClassSessionStatus,
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("class_sessions")
      .update({ status })
      .eq("id", sessionId);

    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not update the session's status. Please try again.", error);
  }
}
