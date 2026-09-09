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

export type SubmittedStudentValues = {
  firstName: string;
  lastName: string;
  preferredName: string;
  email: string;
  phoneCountry: string;
  phone: string;
  alternatePhone: string;
  dateOfBirth: string;
  gender: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

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
  // Echoes the override checkbox/reason back whenever the duplicate panel
  // is redisplayed (e.g. the reason itself was too short) — same reset
  // problem and same fix as submittedValues below, applied to the panel's
  // own fields so a rejected reason doesn't also silently uncheck the box.
  submittedOverride?: { confirmOverride: boolean; overrideReason: string };
  // Echoes back exactly what was submitted whenever the form is re-shown
  // instead of redirecting (duplicate found, validation failed, save
  // failed) — React resets a <form action={...}> hooked to useActionState
  // to its uncontrolled fields' *original* defaultValue once the action
  // resolves (documented React 19 behavior), which would otherwise wipe
  // the whole form back to blank the moment a duplicate warning appears.
  // Without this, confirming the override on the second submission would
  // fail required-field validation on the now-empty name/phone instead of
  // ever reaching the override logic.
  submittedValues?: SubmittedStudentValues;
};

function profileInputFromFormData(formData: FormData) {
  return {
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    preferredName: formData.get("preferredName"),
    email: formData.get("email"),
    phoneCountry: formData.get("phoneCountry"),
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

function submittedValuesFromFormData(formData: FormData): SubmittedStudentValues {
  const asString = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : "";
  const raw = profileInputFromFormData(formData);
  return {
    firstName: asString(raw.firstName),
    lastName: asString(raw.lastName),
    preferredName: asString(raw.preferredName),
    email: asString(raw.email),
    phoneCountry: asString(raw.phoneCountry),
    phone: asString(raw.phone),
    alternatePhone: asString(raw.alternatePhone),
    dateOfBirth: asString(raw.dateOfBirth),
    gender: asString(raw.gender),
    addressLine1: asString(raw.addressLine1),
    addressLine2: asString(raw.addressLine2),
    city: asString(raw.city),
    state: asString(raw.state),
    postalCode: asString(raw.postalCode),
    emergencyContactName: asString(raw.emergencyContactName),
    emergencyContactPhone: asString(raw.emergencyContactPhone),
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

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = studentProfileSchema.safeParse(profileInputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  const confirmOverride = formData.get("confirmOverride") === "on";
  const overrideReasonRaw = formData.get("overrideReason");

  // Computed once, up front, regardless of confirmOverride — reused both
  // for deciding whether to block on an unconfirmed duplicate and, once
  // confirmed, as the source of truth for the override audit entry (never
  // the client's round-tripped duplicate list, which must not be trusted).
  // A single check right before the create, rather than one before and a
  // second one after, is simpler and no less accurate.
  const duplicateResult = await findDuplicateStudents({
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email ?? null,
    phone: parsed.data.phone,
    dateOfBirth: parsed.data.dateOfBirth ?? null,
  });

  // A failed duplicate check must never be treated as "no duplicates" —
  // that would silently let a real duplicate through unwarned. Surface it
  // and stop, the same as any other failed step (correction #3).
  if (!duplicateResult.ok) {
    return { formError: duplicateResult.error, submittedValues };
  }

  const duplicateMatches = duplicateResult.data;
  const duplicatesForState =
    duplicateMatches.length > 0
      ? duplicateMatches.map((match) => ({
          studentId: match.candidate.id,
          studentCode: match.candidate.studentCode,
          name: `${match.candidate.firstName} ${match.candidate.lastName}`,
          reasons: match.reasons,
          reasonLabels: match.reasons.map((r) => DUPLICATE_REASON_LABELS[r]),
        }))
      : undefined;

  const submittedOverride = {
    confirmOverride,
    overrideReason: typeof overrideReasonRaw === "string" ? overrideReasonRaw : "",
  };

  if (!confirmOverride) {
    if (duplicatesForState) {
      return { duplicates: duplicatesForState, submittedValues, submittedOverride };
    }
  } else {
    const overrideParsed = duplicateOverrideSchema.safeParse({
      reason: overrideReasonRaw,
    });
    if (!overrideParsed.success) {
      // The reason itself is what's invalid — the duplicate panel (and
      // the match list it's showing) must stay visible so the admin isn't
      // dropped back to a form that looks like the duplicate was forgotten.
      return {
        fieldErrors: {
          overrideReason: overrideParsed.error.flatten().fieldErrors.reason,
        },
        duplicates: duplicatesForState,
        submittedValues,
        submittedOverride,
      };
    }
  }

  const created = await createStudentRecord(parsed.data);
  if (!created.ok) {
    return { formError: created.error, submittedValues };
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
    await writeAuditLog({
      actorAuthUserId: ctx.authUserId,
      actorRole: ctx.role,
      action: "student.duplicate_override_confirmed",
      entityType: "student",
      entityId: created.data.id,
      after: {
        reason: (formData.get("overrideReason") as string).trim(),
        matchedStudentCodes: duplicateMatches.map((m) => m.candidate.studentCode),
        matchedRules: Array.from(new Set(duplicateMatches.flatMap((m) => m.reasons))),
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

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = studentProfileSchema.safeParse(profileInputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  const before = await getStudentProfile(studentId);
  const result = await updateStudentProfile(studentId, parsed.data);
  if (!result.ok) {
    return { formError: result.error, submittedValues };
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
