"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  createMyClassSession,
  getMySession,
  updateMyClassSession,
  updateMyClassSessionStatus,
} from "@/lib/data/trainer-portal";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  classSessionInputSchema,
  classSessionStatusSchema,
} from "@/lib/validation/class-sessions";
import type {
  ClassSessionFormState,
  ClassSessionStatusFormState,
} from "@/lib/actions/class-sessions";

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

/**
 * Trainer Portal Class Session actions (Phase 12) — a separate module from
 * lib/actions/class-sessions.ts (Admin), same split as Phase 11 kept
 * lib/data/trainer-portal.ts separate from the Admin-facing data modules:
 * the authorization check here is "is this caller actually a Trainer", and
 * every mutation goes through createMyClassSession/updateMyClassSession*
 * (lib/data/trainer-portal.ts), which independently re-verify the batch is
 * one of the caller's own assignments via getMyBatch before writing —
 * never trusting the role or batch id alone. Reuses Admin's own
 * ClassSessionFormState/ClassSessionStatusFormState shapes (identical form
 * fields, no reason to redeclare) and the same classSessionInputSchema —
 * sharing form-shape validation is not a trust-boundary concern, only the
 * authorization and data-access paths are kept separate.
 */

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

function submittedValuesFromFormData(formData: FormData) {
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

export async function createMyClassSessionAction(
  batchId: string,
  _prevState: ClassSessionFormState,
  formData: FormData,
): Promise<ClassSessionFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "trainer") {
    return { formError: NOT_AUTHORIZED };
  }

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = classSessionInputSchema.safeParse(inputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  const created = await createMyClassSession(batchId, parsed.data);
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

  redirect(`/trainer/batches/${batchId}/sessions/${created.data.id}`);
}

export async function updateMyClassSessionAction(
  batchId: string,
  sessionId: string,
  _prevState: ClassSessionFormState,
  formData: FormData,
): Promise<ClassSessionFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "trainer") {
    return { formError: NOT_AUTHORIZED };
  }

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = classSessionInputSchema.safeParse(inputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  const existing = await getMySession(batchId, sessionId);
  if (!existing.ok) {
    return { formError: existing.error, submittedValues };
  }

  const result = await updateMyClassSession(batchId, sessionId, parsed.data);
  if (!result.ok) {
    return { formError: result.error, submittedValues };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "class_session.update",
    entityType: "class_session",
    entityId: sessionId,
    after: { batchId },
  });

  redirect(`/trainer/batches/${batchId}/sessions/${sessionId}`);
}

export async function updateMyClassSessionStatusAction(
  batchId: string,
  sessionId: string,
  _prevState: ClassSessionStatusFormState,
  formData: FormData,
): Promise<ClassSessionStatusFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "trainer") {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = classSessionStatusSchema.safeParse({ status: formData.get("status") });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const before = await getMySession(batchId, sessionId);
  if (!before.ok) {
    return { formError: before.error };
  }

  const result = await updateMyClassSessionStatus(batchId, sessionId, parsed.data.status);
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

  revalidatePath(`/trainer/batches/${batchId}/sessions/${sessionId}`);
  return { success: true };
}
