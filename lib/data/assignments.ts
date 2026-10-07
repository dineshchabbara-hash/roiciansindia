import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import {
  buildAssignmentAttachmentPath,
  assignmentDisplayFileName,
  ASSIGNMENT_SIGNED_URL_EXPIRY_SECONDS,
  type AssignmentStatus,
  type SubmissionStatus,
} from "@/lib/domain/assignments";
import type { CreateAssignmentInput } from "@/lib/validation/assignments";

export const ASSIGNMENT_ATTACHMENTS_BUCKET = "assignment-attachments";
export const ASSIGNMENT_SUBMISSIONS_BUCKET = "assignment-submissions";
const ATTACHMENTS_BUCKET = ASSIGNMENT_ATTACHMENTS_BUCKET;
const SUBMISSIONS_BUCKET = ASSIGNMENT_SUBMISSIONS_BUCKET;

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[assignments data] ${message}:`, error);
  return { ok: false, error: message };
}

export type AssignmentRow = {
  id: string;
  programId: string;
  batchId: string;
  moduleId: string | null;
  moduleTitle: string | null;
  trainerId: string;
  trainerName: string | null;
  title: string;
  description: string | null;
  attachmentPath: string | null;
  attachmentDisplayName: string | null;
  assignedDate: string;
  dueDate: string;
  maxMarks: number | null;
  status: AssignmentStatus;
  createdAt: string;
};

type AssignmentQueryRow = {
  id: string;
  program_id: string;
  batch_id: string;
  module_id: string | null;
  trainer_id: string;
  title: string;
  description: string | null;
  attachment_path: string | null;
  assigned_date: string;
  due_date: string;
  // numeric(6,2) at the DB level — PostgREST returns every `numeric` column
  // as a string (precision-preserving, same reason installments.amount/
  // payment_plans.total_amount are typed as string in
  // lib/supabase/database.types.ts), converted to `number` only at this
  // module's own boundary (toAssignmentRow below) for display/comparison.
  max_marks: string | null;
  status: AssignmentStatus;
  created_at: string;
  module: { title: string } | null;
  trainer: { first_name: string; last_name: string } | null;
};

const ASSIGNMENT_SELECT =
  "id, program_id, batch_id, module_id, trainer_id, title, description, attachment_path, assigned_date, due_date, max_marks, status, created_at, module:program_modules(title), trainer:trainers(first_name, last_name)";

function toAssignmentRow(row: AssignmentQueryRow): AssignmentRow {
  return {
    id: row.id,
    programId: row.program_id,
    batchId: row.batch_id,
    moduleId: row.module_id,
    moduleTitle: row.module?.title ?? null,
    trainerId: row.trainer_id,
    trainerName: row.trainer
      ? `${row.trainer.first_name} ${row.trainer.last_name}`
      : null,
    title: row.title,
    description: row.description,
    attachmentPath: row.attachment_path,
    attachmentDisplayName: row.attachment_path
      ? assignmentDisplayFileName(row.attachment_path)
      : null,
    assignedDate: row.assigned_date,
    dueDate: row.due_date,
    maxMarks: row.max_marks === null ? null : Number(row.max_marks),
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * Lists a Batch's own Assignments — shared by Admin and Trainer contexts
 * (no role branch of its own); the caller's own RLS-scoped session
 * (assignments_select_admin/_trainer, 20260101000014_rls_policies.sql) is
 * the only thing that actually determines which rows come back, exactly
 * the same discipline as lib/data/materials.ts's own getMaterialsForScope.
 */
export async function getAssignmentsForBatch(
  batchId: string,
): Promise<DataResult<AssignmentRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("assignments")
      .select(ASSIGNMENT_SELECT)
      .eq("batch_id", batchId)
      .order("due_date", { ascending: true });
    if (error) throw error;

    return {
      ok: true,
      data: ((data ?? []) as unknown as AssignmentQueryRow[]).map(toAssignmentRow),
    };
  } catch (error) {
    return fail("Could not load assignments.", error);
  }
}

/**
 * Creates one Assignment — row first (program_id/batch_id/trainer_id are
 * already known from the caller's own verified context, never derived from
 * the upload), then the optional attachment keyed by the now-real
 * assignment id, then an update of `attachment_path`
 * (20260101000029_assignments_storage.sql's own header comment explains why
 * this ordering, unlike Materials, is safe to use directly). If the
 * attachment upload fails, the just-created assignment row is deleted
 * (exact row only — brand new, so it can have no submissions yet) rather
 * than left half-created with no attachment and no way for the caller to
 * retry one, since this phase builds no separate "edit assignment" flow.
 * Uses the caller's own RLS-scoped session throughout, never the
 * admin/service-role client — table RLS (assignments_write_admin/_trainer)
 * and Storage RLS are the real authorization boundary.
 */
export async function createAssignmentRecord(input: {
  programId: string;
  batchId: string;
  trainerId: string;
  data: CreateAssignmentInput;
  file: File | null;
}): Promise<DataResult<{ id: string }>> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: inserted, error: insertError } = await supabase
      .from("assignments")
      .insert({
        program_id: input.programId,
        batch_id: input.batchId,
        module_id: input.data.moduleId,
        trainer_id: input.trainerId,
        title: input.data.title,
        description: input.data.description,
        due_date: input.data.dueDate,
        max_marks: input.data.maxMarks === null ? null : String(input.data.maxMarks),
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    const assignmentId = inserted.id as string;

    if (input.file) {
      const objectId = crypto.randomUUID();
      const path = buildAssignmentAttachmentPath(assignmentId, objectId, input.file.name);

      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(path, input.file, { contentType: input.file.type || undefined });
      if (uploadError) {
        await supabase.from("assignments").delete().eq("id", assignmentId);
        throw uploadError;
      }

      const { error: updateError } = await supabase
        .from("assignments")
        .update({ attachment_path: path })
        .eq("id", assignmentId);
      if (updateError) {
        await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
        await supabase.from("assignments").delete().eq("id", assignmentId);
        throw updateError;
      }
    }

    return { ok: true, data: { id: assignmentId } };
  } catch (error) {
    return fail("Could not create the assignment. Please try again.", error);
  }
}

export async function getAssignmentById(
  assignmentId: string,
): Promise<DataResult<AssignmentRow>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("assignments")
      .select(ASSIGNMENT_SELECT)
      .eq("id", assignmentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "Assignment not found." };
    return { ok: true, data: toAssignmentRow(data as unknown as AssignmentQueryRow) };
  } catch (error) {
    return fail("Could not load the assignment.", error);
  }
}

export async function updateAssignmentStatus(
  assignmentId: string,
  status: AssignmentStatus,
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("assignments")
      .update({ status })
      .eq("id", assignmentId);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not update the assignment's status. Please try again.", error);
  }
}

/**
 * Resolves a short-lived signed URL for one Assignment's attachment.
 * Re-fetches the assignment row through the caller's own RLS-scoped
 * session first — a caller the row isn't visible to gets a safe "not
 * found" rather than ever attempting a Storage call for an assignment they
 * were never shown. Role-agnostic (Admin/Trainer/Student all call this same
 * function), exactly like lib/data/materials.ts's own getMaterialAccessUrl.
 */
export async function getAssignmentAttachmentUrl(
  assignmentId: string,
): Promise<DataResult<{ url: string }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: assignment, error: fetchError } = await supabase
      .from("assignments")
      .select("id, attachment_path")
      .eq("id", assignmentId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!assignment) return { ok: false, error: "Assignment not found." };
    if (!assignment.attachment_path) {
      return { ok: false, error: "This assignment has no attachment." };
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(assignment.attachment_path, ASSIGNMENT_SIGNED_URL_EXPIRY_SECONDS);
    if (signError) throw signError;
    if (!signed?.signedUrl)
      return { ok: false, error: "Could not generate a download link." };

    return { ok: true, data: { url: signed.signedUrl } };
  } catch (error) {
    return fail("Could not generate a download link.", error);
  }
}

// ---------------------------------------------------------------------------
// Submissions

export type SubmissionRow = {
  id: string;
  assignmentId: string;
  enrollmentId: string;
  studentId: string;
  studentCode: string | null;
  studentName: string | null;
  submittedAt: string | null;
  textResponse: string | null;
  filePath: string | null;
  fileDisplayName: string | null;
  status: SubmissionStatus;
  marks: number | null;
  trainerFeedback: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

type SubmissionQueryRow = {
  id: string;
  assignment_id: string;
  enrollment_id: string;
  student_id: string;
  submitted_at: string | null;
  text_response: string | null;
  file_path: string | null;
  status: SubmissionStatus;
  // numeric(6,2) — PostgREST string, see AssignmentQueryRow.max_marks's own
  // comment above.
  marks: string | null;
  trainer_feedback: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  student: { student_code: string; first_name: string; last_name: string } | null;
};

const SUBMISSION_SELECT =
  "id, assignment_id, enrollment_id, student_id, submitted_at, text_response, file_path, status, marks, trainer_feedback, reviewed_by, reviewed_at, student:students(student_code, first_name, last_name)";

function toSubmissionRow(row: SubmissionQueryRow): SubmissionRow {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    enrollmentId: row.enrollment_id,
    studentId: row.student_id,
    studentCode: row.student?.student_code ?? null,
    studentName: row.student
      ? `${row.student.first_name} ${row.student.last_name}`
      : null,
    submittedAt: row.submitted_at,
    textResponse: row.text_response,
    filePath: row.file_path,
    fileDisplayName: row.file_path ? assignmentDisplayFileName(row.file_path) : null,
    status: row.status,
    marks: row.marks === null ? null : Number(row.marks),
    trainerFeedback: row.trainer_feedback,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
  };
}

/**
 * Lists submissions for one Assignment — shared by Admin/Trainer contexts.
 * RLS (assignment_submissions_select_admin/_trainer) is the real boundary:
 * a Trainer unrelated to the assignment's batch gets an empty list, not an
 * error (same "not found" vs "empty" distinction every other RLS-scoped
 * list in this codebase already makes — the caller still re-verifies the
 * assignment itself belongs to their own context before calling this, see
 * lib/data/trainer-portal.ts's getMyAssignment).
 */
export async function getSubmissionsForAssignment(
  assignmentId: string,
): Promise<DataResult<SubmissionRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("assignment_submissions")
      .select(SUBMISSION_SELECT)
      .eq("assignment_id", assignmentId);
    if (error) throw error;

    return {
      ok: true,
      data: ((data ?? []) as unknown as SubmissionQueryRow[]).map(toSubmissionRow),
    };
  } catch (error) {
    return fail("Could not load submissions.", error);
  }
}

/**
 * Sets marks/feedback and the next lifecycle status on one submission.
 * `reviewerTrainerId` is null for an Admin review — assignment_submissions.
 * reviewed_by has a FOREIGN KEY to `trainers(id)` only (DATABASE_SCHEMA.md
 * §4 / 20260101000008_academic_tables.sql), there is no column shaped to
 * hold an Admin's own `admins.id` here at all, so an Admin-performed review
 * leaves `reviewed_by` null rather than attempting to store a value the
 * column's own FK would reject — `reviewed_at` still records that a review
 * happened. Uses the caller's own RLS-scoped session
 * (assignment_submissions_update_admin/_trainer) — never the service-role
 * client.
 */
export async function reviewSubmission(input: {
  submissionId: string;
  marks: number | null;
  trainerFeedback: string | null;
  nextStatus: "reviewed" | "resubmission_requested";
  reviewerTrainerId: string | null;
}): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("assignment_submissions")
      .update({
        marks: input.marks === null ? null : String(input.marks),
        trainer_feedback: input.trainerFeedback,
        status: input.nextStatus,
        reviewed_by: input.reviewerTrainerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", input.submissionId);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not save the review. Please try again.", error);
  }
}

/**
 * Resolves a short-lived signed URL for one submission's file. Re-fetches
 * the submission row through the caller's own RLS-scoped session first
 * (assignment_submissions_select_own/_trainer/_admin) — role-agnostic, same
 * pattern as getAssignmentAttachmentUrl above.
 */
export async function getSubmissionFileUrl(
  submissionId: string,
): Promise<DataResult<{ url: string }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: submission, error: fetchError } = await supabase
      .from("assignment_submissions")
      .select("id, file_path")
      .eq("id", submissionId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!submission) return { ok: false, error: "Submission not found." };
    if (!submission.file_path) {
      return { ok: false, error: "This submission has no file." };
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(SUBMISSIONS_BUCKET)
      .createSignedUrl(submission.file_path, ASSIGNMENT_SIGNED_URL_EXPIRY_SECONDS);
    if (signError) throw signError;
    if (!signed?.signedUrl)
      return { ok: false, error: "Could not generate a download link." };

    return { ok: true, data: { url: signed.signedUrl } };
  } catch (error) {
    return fail("Could not generate a download link.", error);
  }
}
