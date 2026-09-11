"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import {
  assignTrainerToBatch,
  createBatchRecord,
  findExistingAssignment,
  getBatchProfile,
  unassignTrainerFromBatch,
  updateBatchProfile,
  updateBatchStatus,
} from "@/lib/data/batches";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  batchProfileSchema,
  batchStatusSchema,
  trainerAssignmentSchema,
} from "@/lib/validation/batches";

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type SubmittedBatchValues = {
  programId: string;
  name: string;
  startDate: string;
  expectedEndDate: string;
  daysOfWeek: string;
  startTime: string;
  endTime: string;
  timezone: string;
  deliveryMode: string;
  capacity: string;
  meetingLink: string;
  location: string;
  notes: string;
};

export type BatchFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  success?: boolean;
  // Same React 19 form-reset problem/fix as Student/Trainer/Program
  // Management's FormState types.
  submittedValues?: SubmittedBatchValues;
};

export type TrainerAssignmentFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  success?: boolean;
};

function profileInputFromFormData(formData: FormData) {
  return {
    programId: formData.get("programId"),
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    expectedEndDate: formData.get("expectedEndDate"),
    daysOfWeek: formData.get("daysOfWeek"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    timezone: formData.get("timezone"),
    deliveryMode: formData.get("deliveryMode"),
    capacity: formData.get("capacity"),
    meetingLink: formData.get("meetingLink"),
    location: formData.get("location"),
    notes: formData.get("notes"),
  };
}

function submittedValuesFromFormData(formData: FormData): SubmittedBatchValues {
  const asString = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : "";
  const raw = profileInputFromFormData(formData);
  return {
    programId: asString(raw.programId),
    name: asString(raw.name),
    startDate: asString(raw.startDate),
    expectedEndDate: asString(raw.expectedEndDate),
    daysOfWeek: asString(raw.daysOfWeek),
    startTime: asString(raw.startTime),
    endTime: asString(raw.endTime),
    timezone: asString(raw.timezone),
    deliveryMode: asString(raw.deliveryMode),
    capacity: asString(raw.capacity),
    meetingLink: asString(raw.meetingLink),
    location: asString(raw.location),
    notes: asString(raw.notes),
  };
}

export async function createBatchAction(
  _prevState: BatchFormState,
  formData: FormData,
): Promise<BatchFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = batchProfileSchema.safeParse(profileInputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  const created = await createBatchRecord(parsed.data);
  if (!created.ok) {
    return { formError: created.error, submittedValues };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "batch.create",
    entityType: "batch",
    entityId: created.data.id,
    after: { name: parsed.data.name },
  });

  redirect(`/admin/batches/${created.data.id}`);
}

export async function updateBatchAction(
  batchId: string,
  _prevState: BatchFormState,
  formData: FormData,
): Promise<BatchFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = batchProfileSchema.safeParse(profileInputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  const before = await getBatchProfile(batchId);
  const result = await updateBatchProfile(batchId, parsed.data);
  if (!result.ok) {
    return { formError: result.error, submittedValues };
  }

  // programId is deliberately excluded: Program reassignment is not
  // exposed at all in Phase 8 (see updateBatchProfile's comment), so it is
  // never part of this diff.
  const changedFields = before.ok
    ? Object.entries({
        name: parsed.data.name,
        startDate: parsed.data.startDate,
        expectedEndDate: parsed.data.expectedEndDate,
        daysOfWeek: parsed.data.daysOfWeek.join(","),
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
        timezone: parsed.data.timezone,
        deliveryMode: parsed.data.deliveryMode,
        capacity: parsed.data.capacity,
        meetingLink: parsed.data.meetingLink,
        location: parsed.data.location,
        notes: parsed.data.notes,
      })
        .filter(([key, value]) => {
          const beforeValue = (before.data as unknown as Record<string, unknown>)[key];
          const comparable =
            key === "daysOfWeek" && Array.isArray(beforeValue)
              ? beforeValue.join(",")
              : beforeValue;
          return comparable !== value;
        })
        .map(([key]) => key)
    : [];

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "batch.update",
    entityType: "batch",
    entityId: batchId,
    after: { changedFields },
  });

  redirect(`/admin/batches/${batchId}`);
}

export async function setBatchStatusAction(
  batchId: string,
  _prevState: BatchFormState,
  formData: FormData,
): Promise<BatchFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = batchStatusSchema.safeParse({ status: formData.get("status") });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const before = await getBatchProfile(batchId);
  const result = await updateBatchStatus(batchId, parsed.data.status);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "batch.status_change",
    entityType: "batch",
    entityId: batchId,
    before: before.ok ? { status: before.data.status } : null,
    after: { status: parsed.data.status },
  });

  revalidatePath(`/admin/batches/${batchId}`);
  return { success: true };
}

export async function assignTrainerAction(
  batchId: string,
  _prevState: TrainerAssignmentFormState,
  formData: FormData,
): Promise<TrainerAssignmentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = trainerAssignmentSchema.safeParse({
    trainerId: formData.get("trainerId"),
    isPrimary: formData.get("isPrimary"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // Duplicate assignment is a hard block with no override — batch_trainers
  // has a real DB unique constraint (batch_id, trainer_id) and there is no
  // documented override workflow for it, unlike Student/Trainer duplicate
  // detection. This pre-check exists only to surface a clear error instead
  // of a raw Postgres error; assignTrainerToBatch's own unique_violation
  // handling is the real backstop for a race.
  const existingResult = await findExistingAssignment(batchId, parsed.data.trainerId);
  if (!existingResult.ok) {
    return { formError: existingResult.error };
  }
  if (existingResult.data) {
    return {
      fieldErrors: { trainerId: ["This trainer is already assigned to this batch."] },
    };
  }

  const result = await assignTrainerToBatch(
    batchId,
    parsed.data.trainerId,
    parsed.data.isPrimary,
  );
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "batch.trainer_assigned",
    entityType: "batch",
    entityId: batchId,
    after: { trainerId: parsed.data.trainerId, isPrimary: parsed.data.isPrimary },
  });

  revalidatePath(`/admin/batches/${batchId}`);
  return { success: true };
}

export async function unassignTrainerAction(
  batchId: string,
  _prevState: TrainerAssignmentFormState,
  formData: FormData,
): Promise<TrainerAssignmentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const trainerId = formData.get("trainerId");
  if (typeof trainerId !== "string" || trainerId.trim().length === 0) {
    return { formError: "Missing trainer to unassign." };
  }

  const result = await unassignTrainerFromBatch(batchId, trainerId);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "batch.trainer_unassigned",
    entityType: "batch",
    entityId: batchId,
    before: { trainerId },
  });

  revalidatePath(`/admin/batches/${batchId}`);
  return { success: true };
}
