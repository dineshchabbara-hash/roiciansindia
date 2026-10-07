"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import {
  createAssignmentRecord,
  updateAssignmentStatus,
  getAssignmentAttachmentUrl,
  getSubmissionFileUrl,
  reviewSubmission,
  getAssignmentById,
} from "@/lib/data/assignments";
import { getBatchProfile, getBatchTrainerAssignments } from "@/lib/data/batches";
import { listProgramModules } from "@/lib/data/materials";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  parseCreateAssignmentFormData,
  parseReviewSubmissionFormData,
} from "@/lib/validation/assignments";
import {
  isAssignmentExtensionAllowed,
  isAssignmentFileSizeAllowed,
  assignmentFileSizeTooLargeError,
  matchesAssignmentFileSignature,
  isMarksWithinCeiling,
  ASSIGNMENT_FILE_TYPE_ERROR,
  ASSIGNMENT_FILE_CONTENT_MISMATCH_ERROR,
  type AssignmentStatus,
} from "@/lib/domain/assignments";

/**
 * Admin-facing Assignments server actions (Phase 16). Re-checks
 * isAdminOrSuperAdmin() server-side before calling into
 * lib/data/assignments.ts, the same pattern lib/actions/materials.ts
 * already establishes — every mutation is server-authorized, never relying
 * on UI hiding. No Trainer path exists in this file at all (see
 * lib/actions/trainer-assignments.ts); Student access is a separate
 * submit-only action (lib/actions/student-assignments.ts).
 */

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type AssignmentFormState = {
  formError?: string;
  success?: boolean;
};

async function extractAndValidateFile(
  formData: FormData,
): Promise<{ ok: true; file: File | null } | { ok: false; error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: true, file: null };
  }
  if (!isAssignmentExtensionAllowed(file.name)) {
    return { ok: false, error: ASSIGNMENT_FILE_TYPE_ERROR };
  }
  if (!isAssignmentFileSizeAllowed(file.name, file.size)) {
    return { ok: false, error: assignmentFileSizeTooLargeError(file.name) };
  }
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!matchesAssignmentFileSignature(file.name, head)) {
    return { ok: false, error: ASSIGNMENT_FILE_CONTENT_MISMATCH_ERROR };
  }
  return { ok: true, file };
}

export async function createBatchAssignmentAction(
  batchId: string,
  _prevState: AssignmentFormState,
  formData: FormData,
): Promise<AssignmentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = parseCreateAssignmentFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid assignment." };
  }

  const trainerId = (formData.get("trainerId") as string | null)?.trim() || "";
  if (!trainerId) {
    return { formError: "Select a trainer assigned to this batch." };
  }

  const batchResult = await getBatchProfile(batchId);
  if (!batchResult.ok) return { formError: batchResult.error };

  // Data-integrity re-check (same posture as Phase 15's own Module-belongs-
  // to-Program audit finding): is_admin_or_super() already grants Admin
  // unrestricted write access to ANY assignment (assignments_write_admin
  // has no scope restriction at all), so this is not an authorization gap
  // — but a tampered direct POST could otherwise attribute an assignment
  // to a Trainer who has nothing to do with this batch, which Trainer-side
  // queries (getMyAssignmentsForBatch) would then silently never surface.
  const assignedTrainers = await getBatchTrainerAssignments(batchId);
  if (
    !assignedTrainers.ok ||
    !assignedTrainers.data.some((t) => t.trainerId === trainerId)
  ) {
    return { formError: "Selected trainer is not assigned to this batch." };
  }

  if (parsed.data.moduleId) {
    const modulesResult = await listProgramModules(batchResult.data.programId);
    if (
      !modulesResult.ok ||
      !modulesResult.data.some((m) => m.id === parsed.data.moduleId)
    ) {
      return { formError: "Selected module does not belong to this batch's program." };
    }
  }

  const fileResult = await extractAndValidateFile(formData);
  if (!fileResult.ok) return { formError: fileResult.error };

  const result = await createAssignmentRecord({
    programId: batchResult.data.programId,
    batchId,
    trainerId,
    data: parsed.data,
    file: fileResult.file,
  });
  if (!result.ok) return { formError: result.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "assignment.create",
    entityType: "assignment",
    entityId: result.data.id,
    after: { batchId, trainerId, dueDate: parsed.data.dueDate },
  });

  revalidatePath(`/admin/batches/${batchId}`);
  return { success: true };
}

export async function updateAssignmentStatusAction(
  assignmentId: string,
  batchId: string,
  _prevState: AssignmentFormState,
  formData: FormData,
): Promise<AssignmentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) return { formError: NOT_AUTHORIZED };

  const nextStatus = formData.get("status") as AssignmentStatus | null;
  if (nextStatus !== "active" && nextStatus !== "closed") {
    return { formError: "Invalid status." };
  }

  const result = await updateAssignmentStatus(assignmentId, nextStatus);
  if (!result.ok) return { formError: result.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "assignment.status_update",
    entityType: "assignment",
    entityId: assignmentId,
    after: { status: nextStatus },
  });

  revalidatePath(`/admin/batches/${batchId}`);
  return { success: true };
}

export async function reviewSubmissionAsAdminAction(
  submissionId: string,
  assignmentId: string,
  batchId: string,
  _prevState: AssignmentFormState,
  formData: FormData,
): Promise<AssignmentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) return { formError: NOT_AUTHORIZED };

  const parsed = parseReviewSubmissionFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid review." };
  }

  if (parsed.data.marks !== null) {
    const assignmentResult = await getAssignmentById(assignmentId);
    if (!assignmentResult.ok) return { formError: assignmentResult.error };
    if (!isMarksWithinCeiling(parsed.data.marks, assignmentResult.data.maxMarks)) {
      return {
        formError: `Marks must be between 0 and ${assignmentResult.data.maxMarks} (this assignment's max marks).`,
      };
    }
  }

  // reviewed_by has a FOREIGN KEY to trainers(id) only (DATABASE_SCHEMA.md
  // §4) — an Admin review has no matching profile id to store here, so
  // reviewed_by is left null; reviewed_at still records that a review
  // happened. See lib/data/assignments.ts's own reviewSubmission header
  // comment.
  const result = await reviewSubmission({
    submissionId,
    marks: parsed.data.marks,
    trainerFeedback: parsed.data.trainerFeedback,
    nextStatus: parsed.data.nextStatus,
    reviewerTrainerId: null,
  });
  if (!result.ok) return { formError: result.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "submission.review",
    entityType: "assignment_submission",
    entityId: submissionId,
    after: { status: parsed.data.nextStatus },
  });

  revalidatePath(`/admin/batches/${batchId}`);
  return { success: true };
}

/**
 * Shared "View attachment" action — Admin, Trainer, and Student all call
 * this same action. Authorization is entirely lib/data/assignments.ts's
 * own getAssignmentAttachmentUrl, which re-fetches the assignment through
 * the caller's own RLS-scoped session first and only then mints a signed
 * URL through that same session (so Storage RLS independently gates it
 * too) — never persisted, expires after ASSIGNMENT_SIGNED_URL_EXPIRY_SECONDS.
 */
export async function getAssignmentAttachmentUrlAction(
  assignmentId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ctx = await getCurrentUserContext();
  if (!ctx) return { ok: false, error: NOT_AUTHORIZED };

  const result = await getAssignmentAttachmentUrl(assignmentId);
  if (!result.ok) return result;
  return { ok: true, url: result.data.url };
}

/** Shared "View submission file" action — same pattern as above. */
export async function getSubmissionFileUrlAction(
  submissionId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ctx = await getCurrentUserContext();
  if (!ctx) return { ok: false, error: NOT_AUTHORIZED };

  const result = await getSubmissionFileUrl(submissionId);
  if (!result.ok) return result;
  return { ok: true, url: result.data.url };
}
