"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import {
  assignEnrollmentBatch,
  createEnrollmentRecord,
  getEnrollmentProfile,
  updateEnrollmentStatus,
} from "@/lib/data/enrollments";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  enrollmentBatchAssignmentSchema,
  enrollmentCreateSchema,
  enrollmentStatusSchema,
} from "@/lib/validation/enrollments";

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type SubmittedEnrollmentValues = {
  studentId: string;
  programId: string;
  batchId: string;
  enrollmentDate: string;
  regularFee: string;
  agreedFee: string;
  discountAmount: string;
  discountReason: string;
  registrationFee: string;
  taxAmount: string;
  paymentPlanType: string;
  source: string;
  notes: string;
};

export type EnrollmentFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  success?: boolean;
  // Same React 19 form-reset problem/fix as Student/Trainer/Program/Batch
  // Management's FormState types.
  submittedValues?: SubmittedEnrollmentValues;
};

function createInputFromFormData(formData: FormData) {
  return {
    studentId: formData.get("studentId"),
    programId: formData.get("programId"),
    batchId: formData.get("batchId"),
    enrollmentDate: formData.get("enrollmentDate"),
    regularFee: formData.get("regularFee"),
    agreedFee: formData.get("agreedFee"),
    discountAmount: formData.get("discountAmount"),
    discountReason: formData.get("discountReason"),
    registrationFee: formData.get("registrationFee"),
    taxAmount: formData.get("taxAmount"),
    paymentPlanType: formData.get("paymentPlanType"),
    source: formData.get("source"),
    notes: formData.get("notes"),
  };
}

function submittedValuesFromFormData(formData: FormData): SubmittedEnrollmentValues {
  const asString = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : "";
  const raw = createInputFromFormData(formData);
  return {
    studentId: asString(raw.studentId),
    programId: asString(raw.programId),
    batchId: asString(raw.batchId),
    enrollmentDate: asString(raw.enrollmentDate),
    regularFee: asString(raw.regularFee),
    agreedFee: asString(raw.agreedFee),
    discountAmount: asString(raw.discountAmount),
    discountReason: asString(raw.discountReason),
    registrationFee: asString(raw.registrationFee),
    taxAmount: asString(raw.taxAmount),
    paymentPlanType: asString(raw.paymentPlanType),
    source: asString(raw.source),
    notes: asString(raw.notes),
  };
}

export type EnrollmentStatusFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  success?: boolean;
};

export async function createEnrollmentAction(
  _prevState: EnrollmentFormState,
  formData: FormData,
): Promise<EnrollmentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = enrollmentCreateSchema.safeParse(createInputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  const created = await createEnrollmentRecord(parsed.data);
  if (!created.ok) {
    return { formError: created.error, submittedValues };
  }

  // Minimal metadata only: no full Student/financial object, no PII beyond
  // the ids already used to scope every other Phase 5-8 audit event.
  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "enrollment.create",
    entityType: "enrollment",
    entityId: created.data.id,
    after: {
      studentId: parsed.data.studentId,
      programId: parsed.data.programId,
      batchId: parsed.data.batchId,
    },
  });

  redirect(`/admin/enrollments/${created.data.id}`);
}

export async function setEnrollmentStatusAction(
  enrollmentId: string,
  _prevState: EnrollmentStatusFormState,
  formData: FormData,
): Promise<EnrollmentStatusFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = enrollmentStatusSchema.safeParse({ status: formData.get("status") });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const before = await getEnrollmentProfile(enrollmentId);
  const result = await updateEnrollmentStatus(enrollmentId, parsed.data.status);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "enrollment.status_change",
    entityType: "enrollment",
    entityId: enrollmentId,
    before: before.ok ? { status: before.data.status } : null,
    after: { status: parsed.data.status },
  });

  revalidatePath(`/admin/enrollments/${enrollmentId}`);
  return { success: true };
}

export type EnrollmentBatchAssignmentFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  success?: boolean;
};

export async function assignEnrollmentBatchAction(
  enrollmentId: string,
  _prevState: EnrollmentBatchAssignmentFormState,
  formData: FormData,
): Promise<EnrollmentBatchAssignmentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = enrollmentBatchAssignmentSchema.safeParse({
    batchId: formData.get("batchId"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const result = await assignEnrollmentBatch(enrollmentId, parsed.data.batchId);
  if (!result.ok) {
    return { formError: result.error };
  }

  // Minimal metadata only: ids, never financial fields or full objects —
  // same convention as every other Phase 5-9 audit event.
  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "enrollment.batch_change",
    entityType: "enrollment",
    entityId: enrollmentId,
    before: { batchId: result.data.oldBatchId },
    after: { batchId: result.data.newBatchId },
  });

  revalidatePath(`/admin/enrollments/${enrollmentId}`);
  return { success: true };
}
