"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  createMyAssignment,
  reviewMySubmission,
  getMyAssignment,
  updateMyAssignmentStatus,
} from "@/lib/data/trainer-portal";
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
import type { AssignmentFormState } from "@/lib/actions/assignments";

/**
 * Trainer-facing Assignments server actions (Phase 16) — create and
 * review only, assigned-Batch scope only, matching assignments_write_
 * trainer / assignment_submissions_update_trainer RLS exactly (no delete
 * policy exists for Trainer at the database level at all, so no such
 * action exists here either). lib/data/trainer-portal.ts's
 * createMyAssignment/reviewMySubmission re-verify the caller is actually
 * assigned to the target Batch/assignment before any write — defense in
 * depth, table/Storage RLS enforce the same boundary independently
 * regardless.
 */

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

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

export async function createMyBatchAssignmentAction(
  batchId: string,
  _prevState: AssignmentFormState,
  formData: FormData,
): Promise<AssignmentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "trainer") return { formError: NOT_AUTHORIZED };

  const parsed = parseCreateAssignmentFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid assignment." };
  }

  const fileResult = await extractAndValidateFile(formData);
  if (!fileResult.ok) return { formError: fileResult.error };

  const result = await createMyAssignment(batchId, parsed.data, fileResult.file);
  if (!result.ok) return { formError: result.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "assignment.create",
    entityType: "assignment",
    entityId: result.data.id,
    after: { batchId, dueDate: parsed.data.dueDate },
  });

  revalidatePath(`/trainer/batches/${batchId}`);
  return { success: true };
}

export async function updateMyAssignmentStatusAction(
  assignmentId: string,
  batchId: string,
  _prevState: AssignmentFormState,
  formData: FormData,
): Promise<AssignmentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "trainer") return { formError: NOT_AUTHORIZED };

  const nextStatus = formData.get("status") as AssignmentStatus | null;
  if (nextStatus !== "active" && nextStatus !== "closed") {
    return { formError: "Invalid status." };
  }

  const result = await updateMyAssignmentStatus(batchId, assignmentId, nextStatus);
  if (!result.ok) return { formError: result.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "assignment.status_update",
    entityType: "assignment",
    entityId: assignmentId,
    after: { status: nextStatus },
  });

  revalidatePath(`/trainer/batches/${batchId}`);
  return { success: true };
}

export async function reviewMySubmissionAction(
  batchId: string,
  assignmentId: string,
  submissionId: string,
  _prevState: AssignmentFormState,
  formData: FormData,
): Promise<AssignmentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "trainer") return { formError: NOT_AUTHORIZED };

  const parsed = parseReviewSubmissionFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid review." };
  }

  if (parsed.data.marks !== null) {
    const assignmentResult = await getMyAssignment(batchId, assignmentId);
    if (!assignmentResult.ok) return { formError: assignmentResult.error };
    if (!isMarksWithinCeiling(parsed.data.marks, assignmentResult.data.maxMarks)) {
      return {
        formError: `Marks must be between 0 and ${assignmentResult.data.maxMarks} (this assignment's max marks).`,
      };
    }
  }

  const result = await reviewMySubmission(
    batchId,
    assignmentId,
    submissionId,
    parsed.data,
  );
  if (!result.ok) return { formError: result.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "submission.review",
    entityType: "assignment_submission",
    entityId: submissionId,
    after: { status: parsed.data.nextStatus },
  });

  revalidatePath(`/trainer/batches/${batchId}`);
  return { success: true };
}
