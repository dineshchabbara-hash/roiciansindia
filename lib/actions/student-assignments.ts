"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { submitMyAssignment } from "@/lib/data/student-portal";
import { writeAuditLog } from "@/lib/data/audit-log";
import { submitAssignmentSchema } from "@/lib/validation/assignments";
import {
  isAssignmentExtensionAllowed,
  isAssignmentFileSizeAllowed,
  assignmentFileSizeTooLargeError,
  matchesAssignmentFileSignature,
  ASSIGNMENT_FILE_TYPE_ERROR,
  ASSIGNMENT_FILE_CONTENT_MISMATCH_ERROR,
} from "@/lib/domain/assignments";
import type { AssignmentFormState } from "@/lib/actions/assignments";

/**
 * Student-facing Assignments server action (Phase 16) — submit (create or
 * update own submission) only, matching assignment_submissions_write_own/
 * _update_own RLS exactly (no Student delete policy exists at the database
 * level at all, so no such action exists here either).
 * lib/data/student-portal.ts's submitMyAssignment re-derives the caller's
 * own enrollment_id/student_id server-side — this action never passes
 * either through from the form (REQUIREMENTS §8/§9: "never trust
 * browser-supplied ... enrollment_id").
 */

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export async function submitMyAssignmentAction(
  assignmentId: string,
  enrollmentId: string,
  _prevState: AssignmentFormState,
  formData: FormData,
): Promise<AssignmentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "student") return { formError: NOT_AUTHORIZED };

  const parsed = submitAssignmentSchema.safeParse({
    textResponse: formData.get("textResponse"),
  });
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid submission." };
  }

  const file = formData.get("file");
  let validatedFile: File | null = null;
  if (file instanceof File && file.size > 0) {
    if (!isAssignmentExtensionAllowed(file.name)) {
      return { formError: ASSIGNMENT_FILE_TYPE_ERROR };
    }
    if (!isAssignmentFileSizeAllowed(file.name, file.size)) {
      return { formError: assignmentFileSizeTooLargeError(file.name) };
    }
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (!matchesAssignmentFileSignature(file.name, head)) {
      return { formError: ASSIGNMENT_FILE_CONTENT_MISMATCH_ERROR };
    }
    validatedFile = file;
  }

  const result = await submitMyAssignment(assignmentId, parsed.data, validatedFile);
  if (!result.ok) return { formError: result.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "submission.create_or_update",
    entityType: "assignment_submission",
    entityId: result.data.id,
    after: { assignmentId },
  });

  revalidatePath(`/student/enrollments/${enrollmentId}`);
  return { success: true };
}
