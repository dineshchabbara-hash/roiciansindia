"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { createMyMaterial } from "@/lib/data/trainer-portal";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  parseCreateMaterialFormData,
  type CreateMaterialInput,
} from "@/lib/validation/materials";
import {
  isMaterialExtensionAllowed,
  isMaterialFileSizeAllowed,
  materialFileSizeTooLargeError,
  matchesMaterialFileSignature,
  MATERIAL_FILE_TYPE_ERROR,
  MATERIAL_FILE_CONTENT_MISMATCH_ERROR,
} from "@/lib/domain/materials";
import type { MaterialFormState } from "@/lib/actions/materials";

/**
 * Trainer-facing Materials server action (Phase 15) — create only, Batch/
 * Session scope only, matching materials_write_trainer RLS exactly (no
 * update/delete policy exists for Trainer at the database level at all, so
 * no such action exists here either). lib/data/trainer-portal.ts's
 * createMyMaterial re-verifies the caller is actually assigned to the
 * target Batch/Session before any write — defense in depth, Storage/table
 * RLS enforce the same boundary independently regardless.
 */

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

async function extractAndValidateFile(
  formData: FormData,
  materialType: CreateMaterialInput["materialType"],
): Promise<{ ok: true; file: File | null } | { ok: false; error: string }> {
  if (materialType !== "file") return { ok: true, file: null };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "A file is required for a file material." };
  }
  if (!isMaterialExtensionAllowed(file.name)) {
    return { ok: false, error: MATERIAL_FILE_TYPE_ERROR };
  }
  if (!isMaterialFileSizeAllowed(file.name, file.size)) {
    return { ok: false, error: materialFileSizeTooLargeError(file.name) };
  }
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!matchesMaterialFileSignature(file.name, head)) {
    return { ok: false, error: MATERIAL_FILE_CONTENT_MISMATCH_ERROR };
  }
  return { ok: true, file };
}

export async function createMyBatchMaterialAction(
  batchId: string,
  _prevState: MaterialFormState,
  formData: FormData,
): Promise<MaterialFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "trainer") return { formError: NOT_AUTHORIZED };

  const parsed = parseCreateMaterialFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid material." };
  }

  const fileResult = await extractAndValidateFile(formData, parsed.data.materialType);
  if (!fileResult.ok) return { formError: fileResult.error };

  const result = await createMyMaterial(
    { type: "batch", batchId },
    parsed.data,
    fileResult.file,
  );
  if (!result.ok) return { formError: result.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "material.create",
    entityType: "material",
    entityId: result.data.id,
    after: {
      scopeType: "batch",
      scopeId: batchId,
      materialType: parsed.data.materialType,
    },
  });

  revalidatePath(`/trainer/batches/${batchId}`);
  return { success: true };
}

export async function createMySessionMaterialAction(
  batchId: string,
  sessionId: string,
  _prevState: MaterialFormState,
  formData: FormData,
): Promise<MaterialFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "trainer") return { formError: NOT_AUTHORIZED };

  const parsed = parseCreateMaterialFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid material." };
  }

  const fileResult = await extractAndValidateFile(formData, parsed.data.materialType);
  if (!fileResult.ok) return { formError: fileResult.error };

  const result = await createMyMaterial(
    { type: "session", batchId, sessionId },
    parsed.data,
    fileResult.file,
  );
  if (!result.ok) return { formError: result.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "material.create",
    entityType: "material",
    entityId: result.data.id,
    after: {
      scopeType: "session",
      scopeId: sessionId,
      materialType: parsed.data.materialType,
    },
  });

  revalidatePath(`/trainer/batches/${batchId}/sessions/${sessionId}`);
  return { success: true };
}
