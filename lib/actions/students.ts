"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import {
  createStudentRecord,
  deleteStudentDocument,
  findDuplicateStudents,
  getStudentProfile,
  insertStudentNote,
  updateStudentProfile,
  updateStudentStatus,
  uploadStudentDocument,
} from "@/lib/data/students";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  DUPLICATE_REASON_LABELS,
  type DuplicateMatchReason,
} from "@/lib/domain/students";
import {
  duplicateOverrideSchema,
  studentNoteSchema,
  studentProfileSchema,
  studentStatusSchema,
} from "@/lib/validation/students";

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type StudentFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  success?: boolean;
  duplicates?: Array<{
    studentId: string;
    studentCode: string;
    name: string;
    reasons: DuplicateMatchReason[];
    reasonLabels: string[];
  }>;
};

function profileInputFromFormData(formData: FormData) {
  return {
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    preferredName: formData.get("preferredName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    alternatePhone: formData.get("alternatePhone"),
    dateOfBirth: formData.get("dateOfBirth"),
    gender: formData.get("gender"),
    addressLine1: formData.get("addressLine1"),
    addressLine2: formData.get("addressLine2"),
    city: formData.get("city"),
    state: formData.get("state"),
    postalCode: formData.get("postalCode"),
    emergencyContactName: formData.get("emergencyContactName"),
    emergencyContactPhone: formData.get("emergencyContactPhone"),
  };
}

export async function createStudentAction(
  _prevState: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role) || !ctx.profileId) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = studentProfileSchema.safeParse(profileInputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const confirmOverride = formData.get("confirmOverride") === "on";
  const overrideReasonRaw = formData.get("overrideReason");

  if (!confirmOverride) {
    const duplicateResult = await findDuplicateStudents({
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone,
      dateOfBirth: parsed.data.dateOfBirth ?? null,
    });

    if (duplicateResult.ok && duplicateResult.data.length > 0) {
      return {
        duplicates: duplicateResult.data.map((match) => ({
          studentId: match.candidate.id,
          studentCode: match.candidate.studentCode,
          name: `${match.candidate.firstName} ${match.candidate.lastName}`,
          reasons: match.reasons,
          reasonLabels: match.reasons.map((r) => DUPLICATE_REASON_LABELS[r]),
        })),
      };
    }
  } else {
    const overrideParsed = duplicateOverrideSchema.safeParse({
      reason: overrideReasonRaw,
    });
    if (!overrideParsed.success) {
      return {
        fieldErrors: {
          overrideReason: overrideParsed.error.flatten().fieldErrors.reason,
        },
      };
    }
  }

  const created = await createStudentRecord(parsed.data);
  if (!created.ok) {
    return { formError: created.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "student.create",
    entityType: "student",
    entityId: created.data.id,
    after: { studentCode: created.data.studentCode },
  });

  if (confirmOverride) {
    // Re-run the duplicate check to capture exactly which existing
    // students/rules matched, for the override audit entry — the form's
    // own duplicate list is client-round-tripped and must not be trusted
    // as the source of truth for what actually matched.
    const duplicateResult = await findDuplicateStudents({
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone,
      dateOfBirth: parsed.data.dateOfBirth ?? null,
    });
    const matches = duplicateResult.ok ? duplicateResult.data : [];

    await writeAuditLog({
      actorAuthUserId: ctx.authUserId,
      actorRole: ctx.role,
      action: "student.duplicate_override_confirmed",
      entityType: "student",
      entityId: created.data.id,
      after: {
        reason: (formData.get("overrideReason") as string).trim(),
        matchedStudentCodes: matches.map((m) => m.candidate.studentCode),
        matchedRules: Array.from(new Set(matches.flatMap((m) => m.reasons))),
      },
    });
  }

  redirect(`/admin/students/${created.data.id}`);
}

export async function updateStudentAction(
  studentId: string,
  _prevState: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = studentProfileSchema.safeParse(profileInputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const before = await getStudentProfile(studentId);
  const result = await updateStudentProfile(studentId, parsed.data);
  if (!result.ok) {
    return { formError: result.error };
  }

  const changedFields = before.ok
    ? Object.entries({
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        preferredName: parsed.data.preferredName ?? null,
        email: parsed.data.email ?? null,
        phone: parsed.data.phone,
        alternatePhone: parsed.data.alternatePhone ?? null,
        dateOfBirth: parsed.data.dateOfBirth ?? null,
        gender: parsed.data.gender ?? null,
        addressLine1: parsed.data.addressLine1 ?? null,
        addressLine2: parsed.data.addressLine2 ?? null,
        city: parsed.data.city ?? null,
        state: parsed.data.state ?? null,
        postalCode: parsed.data.postalCode ?? null,
        emergencyContactName: parsed.data.emergencyContactName ?? null,
        emergencyContactPhone: parsed.data.emergencyContactPhone ?? null,
      })
        .filter(([key, value]) => (before.data as Record<string, unknown>)[key] !== value)
        .map(([key]) => key)
    : [];

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "student.update",
    entityType: "student",
    entityId: studentId,
    after: { changedFields },
  });

  redirect(`/admin/students/${studentId}`);
}

export async function setStudentStatusAction(
  studentId: string,
  _prevState: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = studentStatusSchema.safeParse({ status: formData.get("status") });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const before = await getStudentProfile(studentId);
  const result = await updateStudentStatus(studentId, parsed.data.status);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "student.status_change",
    entityType: "student",
    entityId: studentId,
    before: before.ok ? { status: before.data.status } : null,
    after: { status: parsed.data.status },
  });

  revalidatePath(`/admin/students/${studentId}`);
  return { success: true };
}

export async function addStudentNoteAction(
  studentId: string,
  _prevState: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role) || !ctx.profileId) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = studentNoteSchema.safeParse({ note: formData.get("note") });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const result = await insertStudentNote(studentId, parsed.data.note, ctx.profileId);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "student.note.create",
    entityType: "student_note",
    entityId: result.data.id,
    after: { studentId },
  });

  revalidatePath(`/admin/students/${studentId}`);
  return { success: true };
}

export async function uploadStudentDocumentAction(
  studentId: string,
  _prevState: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role) || !ctx.profileId) {
    return { formError: NOT_AUTHORIZED };
  }

  const file = formData.get("file");
  const documentType = formData.get("documentType");

  if (!(file instanceof File) || file.size === 0) {
    return { fieldErrors: { file: ["Choose a file to upload"] } };
  }
  if (typeof documentType !== "string" || documentType.trim().length === 0) {
    return { fieldErrors: { documentType: ["Document type is required"] } };
  }

  const result = await uploadStudentDocument(
    studentId,
    documentType.trim(),
    file,
    ctx.profileId,
  );
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "student.document.upload",
    entityType: "student_document",
    entityId: result.data.id,
    after: { studentId, documentType: documentType.trim() },
  });

  revalidatePath(`/admin/students/${studentId}`);
  return { success: true };
}

export async function deleteStudentDocumentAction(
  studentId: string,
  documentId: string,
): Promise<{ formError?: string; success?: boolean }> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const result = await deleteStudentDocument(studentId, documentId);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "student.document.delete",
    entityType: "student_document",
    entityId: documentId,
    after: { studentId },
  });

  revalidatePath(`/admin/students/${studentId}`);
  return { success: true };
}
