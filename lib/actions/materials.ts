"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import {
  createMaterialRecord,
  getMaterialAccessUrl,
  listProgramModules,
} from "@/lib/data/materials";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  parseCreateMaterialFormData,
  type CreateMaterialInput,
} from "@/lib/validation/materials";
import {
  resolveExactlyOneScope,
  isMaterialExtensionAllowed,
  isMaterialFileSizeAllowed,
  materialFileSizeTooLargeError,
  matchesMaterialFileSignature,
  MATERIAL_FILE_TYPE_ERROR,
  MATERIAL_FILE_CONTENT_MISMATCH_ERROR,
  type MaterialScopeInput,
} from "@/lib/domain/materials";

/**
 * Admin-facing Materials server actions (Phase 15). Re-checks
 * isAdminOrSuperAdmin() server-side before calling into
 * lib/data/materials.ts, the same pattern lib/actions/payment-plans.ts and
 * lib/actions/attendance.ts already establish — every mutation is
 * server-authorized, never relying on UI hiding. No Trainer path exists in
 * this file at all (see lib/actions/trainer-materials.ts); Student access
 * is read-only (lib/data/student-portal.ts's getMyMaterialsForEnrollment).
 *
 * Three separate actions (Program, Batch, Session), each bound to that
 * context page's own entity id — not one generic "pick any scope" action —
 * so the UI itself makes the scope unambiguous (IMPLEMENTATION_PLAN.md's
 * own Phase 15 note: "the workflow should clearly show the scope of a
 * material so Admin cannot accidentally upload to the wrong Program/
 * Batch/session"). The Program action additionally accepts an optional
 * moduleId — if present, the material is Module-scoped instead of
 * Program-scoped (resolveExactlyOneScope enforces exactly one either way).
 */

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type MaterialFormState = {
  formError?: string;
  success?: boolean;
};

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

  // MIME sniffing from actual bytes, not the trusted Content-Type header
  // (SECURITY_PLAN.md §8) — 12 bytes is enough for every signature this
  // project checks (lib/domain/materials.ts).
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!matchesMaterialFileSignature(file.name, head)) {
    return { ok: false, error: MATERIAL_FILE_CONTENT_MISMATCH_ERROR };
  }

  return { ok: true, file };
}

async function createMaterialForScope(
  scopeInput: MaterialScopeInput,
  revalidatePathTarget: string,
  formData: FormData,
): Promise<MaterialFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = parseCreateMaterialFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid material." };
  }

  const scopeResult = resolveExactlyOneScope(scopeInput);
  if (!scopeResult.ok) return { formError: scopeResult.error };

  const fileResult = await extractAndValidateFile(formData, parsed.data.materialType);
  if (!fileResult.ok) return { formError: fileResult.error };

  // materials.uploaded_by follows the same established contract as
  // student_documents.uploaded_by (DATABASE_SCHEMA.md §4): the caller's
  // role-specific profile id (admins.id here), never the raw auth_user_id
  // — see lib/actions/students.ts's own uploadDocumentAction, which passes
  // ctx.profileId for the identical "uuid not null" + role-check-
  // constraint column pairing.
  if (!ctx.profileId) {
    return { formError: "Your admin profile could not be resolved." };
  }

  const result = await createMaterialRecord({
    scope: scopeResult.scope,
    data: parsed.data,
    file: fileResult.file,
    uploadedBy: ctx.profileId,
    uploadedByType: "admin",
  });
  if (!result.ok) return { formError: result.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "material.create",
    entityType: "material",
    entityId: result.data.id,
    after: {
      scopeType: scopeResult.scope.type,
      scopeId: scopeResult.scope.id,
      materialType: parsed.data.materialType,
    },
  });

  revalidatePath(revalidatePathTarget);
  return { success: true };
}

export async function createProgramMaterialAction(
  programId: string,
  _prevState: MaterialFormState,
  formData: FormData,
): Promise<MaterialFormState> {
  // moduleId, when present on this form, takes precedence over the bound
  // programId — resolveExactlyOneScope rejects it if both ever arrived
  // non-empty, but the form itself (Program detail page) never submits
  // both: the Module picker clears/disables the implicit Program scope.
  const moduleId = (formData.get("moduleId") as string | null)?.trim() || null;

  // Audit finding: a submitted moduleId was previously trusted outright —
  // the Module <select> on this page only ever lists this Program's own
  // Modules (listProgramModules(programId)), so normal use can't produce a
  // mismatch, but a tampered direct POST could submit a moduleId belonging
  // to an entirely different Program. is_admin_or_super() already grants
  // Admin unrestricted write access to ANY scope (materials_write_admin
  // has no scope restriction at all), so this was never an authorization
  // gap — but it is a real data-integrity one: a material could otherwise
  // land on an unrelated Program's Module while this page revalidates and
  // behaves as if it belongs here. Re-verified server-side against the
  // actual relationship, never the browser dropdown alone.
  if (moduleId) {
    const modulesResult = await listProgramModules(programId);
    if (!modulesResult.ok || !modulesResult.data.some((m) => m.id === moduleId)) {
      return { formError: "Selected module does not belong to this program." };
    }
  }

  return createMaterialForScope(
    {
      programId: moduleId ? null : programId,
      batchId: null,
      moduleId,
      classSessionId: null,
    },
    `/admin/programs/${programId}`,
    formData,
  );
}

export async function createBatchMaterialAction(
  batchId: string,
  _prevState: MaterialFormState,
  formData: FormData,
): Promise<MaterialFormState> {
  return createMaterialForScope(
    { programId: null, batchId, moduleId: null, classSessionId: null },
    `/admin/batches/${batchId}`,
    formData,
  );
}

export async function createSessionMaterialAction(
  batchId: string,
  classSessionId: string,
  _prevState: MaterialFormState,
  formData: FormData,
): Promise<MaterialFormState> {
  return createMaterialForScope(
    { programId: null, batchId: null, moduleId: null, classSessionId },
    `/admin/batches/${batchId}/sessions/${classSessionId}`,
    formData,
  );
}

/**
 * Shared "View/Download" action — Admin, Trainer, and Student all call
 * this same action (no role branch of its own). Authorization is entirely
 * lib/data/materials.ts's own getMaterialAccessUrl, which re-fetches the
 * material through the caller's own RLS-scoped session first and only
 * then, for a `file` material, mints a signed URL through that same
 * session (so Storage RLS independently gates it too) — never a permanent
 * or cached URL, never persisted, expires after
 * MATERIAL_SIGNED_URL_EXPIRY_SECONDS (lib/domain/materials.ts).
 */
export async function getMaterialAccessUrlAction(
  materialId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ctx = await getCurrentUserContext();
  if (!ctx) return { ok: false, error: NOT_AUTHORIZED };

  const result = await getMaterialAccessUrl(materialId);
  if (!result.ok) return result;
  return { ok: true, url: result.data.url };
}
