import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import {
  buildMaterialObjectPath,
  materialDisplayFileName,
  MATERIAL_SIGNED_URL_EXPIRY_SECONDS,
  type MaterialScope,
  type MaterialType,
} from "@/lib/domain/materials";
import type { CreateMaterialInput } from "@/lib/validation/materials";

const MATERIALS_BUCKET = "materials";

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[materials data] ${message}:`, error);
  return { ok: false, error: message };
}

const SCOPE_COLUMN: Record<MaterialScope["type"], string> = {
  program: "program_id",
  batch: "batch_id",
  module: "module_id",
  session: "class_session_id",
};

export type MaterialRow = {
  id: string;
  title: string;
  description: string | null;
  materialType: MaterialType;
  filePath: string | null;
  externalUrl: string | null;
  displayFileName: string | null;
  uploadedByType: "admin" | "trainer";
  createdAt: string;
  // Only ever set by getProgramMaterialsIncludingModules below — undefined
  // everywhere else (Batch/Session/Trainer/Student lists each already show
  // one unambiguous scope, so there is nothing to label there).
  moduleTitle?: string | null;
};

// Exported so lib/data/student-portal.ts's own getMyMaterialsForEnrollment
// (an `.or()`-based query across program_id/batch_id, a shape
// getMaterialsForScope above doesn't cover) can map rows the same way,
// without a second, drifting copy of this mapping.
export function toMaterialRow(row: {
  id: string;
  title: string;
  description: string | null;
  material_type: MaterialType;
  file_path: string | null;
  external_url: string | null;
  uploaded_by_type: "admin" | "trainer";
  created_at: string;
}): MaterialRow {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    materialType: row.material_type,
    filePath: row.file_path,
    externalUrl: row.external_url,
    displayFileName: row.file_path ? materialDisplayFileName(row.file_path) : null,
    uploadedByType: row.uploaded_by_type,
    createdAt: row.created_at,
  };
}

/**
 * Lists materials scoped EXACTLY to the given Program/Batch/Module/Session
 * (never a hierarchical rollup of e.g. every Batch material under a
 * Program) — the smallest interpretation of FR-70's own "Program, Batch,
 * Session, or Module" wording, matching the one-scope-per-material rule
 * this phase enforces on write. Shared by Admin/Trainer/Student contexts —
 * each caller's own RLS-scoped session (materials_select_admin/_trainer/
 * _student) is the only thing that actually determines which rows come
 * back; this function has no role branches of its own.
 */
export async function getMaterialsForScope(
  scope: MaterialScope,
): Promise<DataResult<MaterialRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("materials")
      .select(
        "id, title, description, material_type, file_path, external_url, uploaded_by_type, created_at",
      )
      .eq(SCOPE_COLUMN[scope.type], scope.id)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return {
      ok: true,
      data: (
        (data ?? []) as Array<{
          id: string;
          title: string;
          description: string | null;
          material_type: MaterialType;
          file_path: string | null;
          external_url: string | null;
          uploaded_by_type: "admin" | "trainer";
          created_at: string;
        }>
      ).map(toMaterialRow),
    };
  } catch (error) {
    return fail("Could not load materials.", error);
  }
}

/**
 * Lists a Program's own materials together with its Modules' materials
 * (each tagged with the owning Module's title, or null for a Program-level
 * row) — used ONLY by the Admin Program detail page. getMaterialsForScope
 * above deliberately lists exactly one scope with no rollup (Batch/Session
 * pages have nothing to roll up), but the Program page's own create form
 * lets Admin choose a Module via the same page (lib/actions/materials.ts's
 * createProgramMaterialAction) — without this, a Module-scoped material
 * would be created successfully and then be invisible everywhere in the
 * Admin UI (materials_select_admin still returns it at the RLS layer; this
 * is a UI-visibility fix only, not an authorization change).
 */
export async function getProgramMaterialsIncludingModules(
  programId: string,
): Promise<DataResult<MaterialRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();

    const MATERIAL_COLUMNS =
      "id, title, description, material_type, file_path, external_url, uploaded_by_type, created_at";

    const [directResult, modulesResult] = await Promise.all([
      supabase.from("materials").select(MATERIAL_COLUMNS).eq("program_id", programId),
      supabase.from("program_modules").select("id, title").eq("program_id", programId),
    ]);
    if (directResult.error) throw directResult.error;
    if (modulesResult.error) throw modulesResult.error;

    const modules = (modulesResult.data ?? []) as Array<{ id: string; title: string }>;
    const moduleTitleById = new Map(modules.map((m) => [m.id, m.title]));

    type MaterialQueryRow = {
      id: string;
      title: string;
      description: string | null;
      material_type: MaterialType;
      file_path: string | null;
      external_url: string | null;
      uploaded_by_type: "admin" | "trainer";
      created_at: string;
    };

    const direct: MaterialRow[] = ((directResult.data ?? []) as MaterialQueryRow[]).map(
      (row) => ({ ...toMaterialRow(row), moduleTitle: null }),
    );

    let moduleScoped: MaterialRow[] = [];
    if (modules.length > 0) {
      const { data: moduleMaterials, error: moduleMaterialsError } = await supabase
        .from("materials")
        .select(`${MATERIAL_COLUMNS}, module_id`)
        .in(
          "module_id",
          modules.map((m) => m.id),
        );
      if (moduleMaterialsError) throw moduleMaterialsError;
      moduleScoped = (
        (moduleMaterials ?? []) as Array<MaterialQueryRow & { module_id: string }>
      ).map((row) => ({
        ...toMaterialRow(row),
        moduleTitle: moduleTitleById.get(row.module_id) ?? null,
      }));
    }

    return {
      ok: true,
      data: [...direct, ...moduleScoped].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      ),
    };
  } catch (error) {
    return fail("Could not load materials.", error);
  }
}

/**
 * Read-only list of a Program's existing Modules, for the Admin create-
 * material form's Module picker — this is a SELECT of whatever
 * program_modules rows already exist, not Module CRUD (which stays out of
 * Phase 15's scope entirely, see IMPLEMENTATION_PLAN.md's own Phase 15
 * note). Returns an empty list when the Program has no Modules yet, same
 * non-broken empty state as an empty Batch list.
 */
export async function listProgramModules(
  programId: string,
): Promise<DataResult<Array<{ id: string; title: string }>>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("program_modules")
      .select("id, title")
      .eq("program_id", programId)
      .order("sequence", { ascending: true });
    if (error) throw error;
    return { ok: true, data: (data ?? []) as Array<{ id: string; title: string }> };
  } catch (error) {
    return fail("Could not load modules.", error);
  }
}

/**
 * Creates one material — a file upload (Storage object then metadata row,
 * same upload-then-insert-with-rollback discipline as
 * lib/data/students.ts's own uploadStudentDocument) or a plain metadata-
 * only insert for `link`/`video` (no Storage object at all, per the
 * table's own materials_file_or_link CHECK). Uses the caller's own
 * RLS-scoped session, never the admin/service-role client — Storage RLS
 * (20260101000027) and table RLS (materials_write_admin/_trainer) are the
 * real authorization boundary, exactly as uploadStudentDocument's own
 * header comment establishes for this codebase. `uploadedBy`/
 * `uploadedByType` are passed in by the caller (Admin or Trainer action),
 * never trusted from form input.
 */
export async function createMaterialRecord(input: {
  scope: MaterialScope;
  data: CreateMaterialInput;
  file: File | null;
  uploadedBy: string;
  uploadedByType: "admin" | "trainer";
}): Promise<DataResult<{ id: string }>> {
  try {
    const supabase = await createSupabaseServerClient();

    let filePath: string | null = null;
    if (input.data.materialType === "file") {
      if (!input.file) {
        return { ok: false, error: "A file is required for a file material." };
      }
      const objectId = crypto.randomUUID();
      filePath = buildMaterialObjectPath(input.scope, objectId, input.file.name);

      const { error: uploadError } = await supabase.storage
        .from(MATERIALS_BUCKET)
        .upload(filePath, input.file, { contentType: input.file.type || undefined });
      if (uploadError) throw uploadError;
    }

    const insertRow: Record<string, unknown> = {
      title: input.data.title,
      description: input.data.description ?? null,
      material_type: input.data.materialType,
      file_path: filePath,
      external_url: input.data.materialType === "file" ? null : input.data.externalUrl,
      uploaded_by: input.uploadedBy,
      uploaded_by_type: input.uploadedByType,
      program_id: null,
      batch_id: null,
      module_id: null,
      class_session_id: null,
    };
    insertRow[SCOPE_COLUMN[input.scope.type]] = input.scope.id;

    const { data, error: insertError } = await supabase
      .from("materials")
      .insert(insertRow)
      .select("id")
      .single();

    if (insertError) {
      if (filePath) {
        // Never leave an orphaned Storage object with no metadata row
        // pointing at it — exact object only, same discipline as every
        // other upload-then-insert path in this codebase.
        await supabase.storage.from(MATERIALS_BUCKET).remove([filePath]);
      }
      throw insertError;
    }

    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail("Could not create the material. Please try again.", error);
  }
}

/**
 * Resolves how to actually access one material's content: a short-lived
 * signed Storage URL for `file` materials (minted fresh on every call,
 * never persisted — lib/domain/materials.ts's own
 * MATERIAL_SIGNED_URL_EXPIRY_SECONDS), or the stored `external_url` for
 * `link`/`video`. Re-fetches the material row through the caller's own
 * RLS-scoped session first — if the row doesn't come back (unrelated
 * Batch, unrelated Student, wrong enrollment status, etc.), this returns
 * a safe "not found" rather than ever attempting a Storage call for a
 * material the caller was never shown. createSignedUrl is called through
 * that SAME session, so Storage RLS (20260101000027) independently gates
 * it too — table RLS failing to deny something is never the only thing
 * standing between an unauthorized caller and the real file bytes.
 */
export async function getMaterialAccessUrl(
  materialId: string,
): Promise<DataResult<{ kind: "signed_url" | "external_url"; url: string }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: material, error: fetchError } = await supabase
      .from("materials")
      .select("id, material_type, file_path, external_url")
      .eq("id", materialId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!material) return { ok: false, error: "Material not found." };

    if (material.material_type !== "file") {
      if (!material.external_url) {
        return { ok: false, error: "This material has no accessible content." };
      }
      return { ok: true, data: { kind: "external_url", url: material.external_url } };
    }

    if (!material.file_path) {
      return { ok: false, error: "This material has no accessible content." };
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(MATERIALS_BUCKET)
      .createSignedUrl(material.file_path, MATERIAL_SIGNED_URL_EXPIRY_SECONDS);
    if (signError) throw signError;
    if (!signed?.signedUrl) {
      return { ok: false, error: "Could not generate a download link." };
    }

    return { ok: true, data: { kind: "signed_url", url: signed.signedUrl } };
  } catch (error) {
    return fail("Could not generate a download link.", error);
  }
}
