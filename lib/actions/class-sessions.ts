"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import {
  createClassSession,
  getClassSession,
  updateClassSession,
  updateClassSessionStatus,
} from "@/lib/data/class-sessions";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  classSessionInputSchema,
  classSessionStatusSchema,
} from "@/lib/validation/class-sessions";

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type SubmittedClassSessionValues = {
  sessionDate: string;
  startTime: string;
  endTime: string;
  topic: string;
  description: string;
  meetingLink: string;
  notes: string;
};

export type ClassSessionFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  success?: boolean;
  // Same React 19 form-reset fix as Batch/Program/Student Management's
  // FormState types.
  submittedValues?: SubmittedClassSessionValues;
};

export type ClassSessionStatusFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  success?: boolean;
};

function inputFromFormData(formData: FormData) {
  return {
    sessionDate: formData.get("sessionDate"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    topic: formData.get("topic"),
    description: formData.get("description"),
    meetingLink: formData.get("meetingLink"),
    notes: formData.get("notes"),
  };
}

function submittedValuesFromFormData(formData: FormData): SubmittedClassSessionValues {
  const asString = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : "";
  const raw = inputFromFormData(formData);
  return {
    sessionDate: asString(raw.sessionDate),
    startTime: asString(raw.startTime),
    endTime: asString(raw.endTime),
    topic: asString(raw.topic),
    description: asString(raw.description),
    meetingLink: asString(raw.meetingLink),
    notes: asString(raw.notes),
  };
}

export async function createClassSessionAction(
  batchId: string,
  _prevState: ClassSessionFormState,
  formData: FormData,
): Promise<ClassSessionFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = classSessionInputSchema.safeParse(inputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  const created = await createClassSession(batchId, parsed.data);
  if (!created.ok) {
    return { formError: created.error, submittedValues };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "class_session.create",
    entityType: "class_session",
    entityId: created.data.id,
    after: { batchId, sessionDate: parsed.data.sessionDate },
  });

  redirect(`/admin/batches/${batchId}/sessions/${created.data.id}`);
}

export async function updateClassSessionAction(
  batchId: string,
  sessionId: string,
  _prevState: ClassSessionFormState,
  formData: FormData,
): Promise<ClassSessionFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = classSessionInputSchema.safeParse(inputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  // Confirms the [id]/[sessionId] route pair actually belong together before
  // writing — the same guard getClassSession enforces for reads.
  const existing = await getClassSession(batchId, sessionId);
  if (!existing.ok) {
    return { formError: existing.error, submittedValues };
  }

  const result = await updateClassSession(sessionId, parsed.data);
  if (!result.ok) {
    return { formError: result.error, submittedValues };
  }

  const changedFields = Object.entries({
    sessionDate: parsed.data.sessionDate,
    startTime: parsed.data.startTime,
    endTime: parsed.data.endTime,
    topic: parsed.data.topic,
    description: parsed.data.description,
    meetingLink: parsed.data.meetingLink,
    notes: parsed.data.notes,
  })
    .filter(([key, value]) => {
      const beforeValue = (existing.data as unknown as Record<string, unknown>)[key];
      return beforeValue !== value;
    })
    .map(([key]) => key);

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "class_session.update",
    entityType: "class_session",
    entityId: sessionId,
    after: { changedFields },
  });

  redirect(`/admin/batches/${batchId}/sessions/${sessionId}`);
}

export async function updateClassSessionStatusAction(
  batchId: string,
  sessionId: string,
  _prevState: ClassSessionStatusFormState,
  formData: FormData,
): Promise<ClassSessionStatusFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = classSessionStatusSchema.safeParse({ status: formData.get("status") });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const before = await getClassSession(batchId, sessionId);
  if (!before.ok) {
    return { formError: before.error };
  }

  const result = await updateClassSessionStatus(sessionId, parsed.data.status);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "class_session.status_change",
    entityType: "class_session",
    entityId: sessionId,
    before: { status: before.data.status },
    after: { status: parsed.data.status },
  });

  revalidatePath(`/admin/batches/${batchId}/sessions/${sessionId}`);
  return { success: true };
}
