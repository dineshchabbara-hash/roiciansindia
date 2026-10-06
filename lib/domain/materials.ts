/**
 * Pure Learning Materials domain logic — no I/O. Mirrors
 * lib/domain/payment-plans.ts's own pattern: only values the schema's own
 * CHECK constraints actually allow (materials.material_type,
 * supabase/migrations/20260101000008_academic_tables.sql), nothing
 * invented.
 */

import { sanitizeFileNameForStorage } from "@/lib/domain/students";

export const MATERIAL_TYPES = ["file", "link", "video"] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];

export function isMaterialType(value: unknown): value is MaterialType {
  return (
    typeof value === "string" && (MATERIAL_TYPES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Scope — Phase 15 approved interpretation (not a DB-level rule): a material
// is attached to exactly ONE of Program/Batch/Module/Session, even though
// the table's own CHECK constraint (materials_scoped) only requires at
// least one. FR-70 says "Program, Batch, Session, or Module" with no
// worked multi-scope example, so this is the smallest, least-invented
// reading — enforced here at the application layer only; the DB CHECK is
// deliberately left exactly as-is (approved Phase 15 decision, see
// IMPLEMENTATION_PLAN.md's own Phase 15 note).

export const MATERIAL_SCOPE_TYPES = ["program", "batch", "module", "session"] as const;
export type MaterialScopeType = (typeof MATERIAL_SCOPE_TYPES)[number];

export type MaterialScopeInput = {
  programId: string | null;
  batchId: string | null;
  moduleId: string | null;
  classSessionId: string | null;
};

export type MaterialScope = { type: MaterialScopeType; id: string };

export function resolveExactlyOneScope(
  input: MaterialScopeInput,
): { ok: true; scope: MaterialScope } | { ok: false; error: string } {
  const provided: MaterialScope[] = [];
  if (input.programId) provided.push({ type: "program", id: input.programId });
  if (input.batchId) provided.push({ type: "batch", id: input.batchId });
  if (input.moduleId) provided.push({ type: "module", id: input.moduleId });
  if (input.classSessionId) provided.push({ type: "session", id: input.classSessionId });

  if (provided.length === 0) {
    return { ok: false, error: "Select a Program, Batch, Module, or Class Session." };
  }
  if (provided.length > 1) {
    return {
      ok: false,
      error:
        "A material may only be scoped to one of Program, Batch, Module, or Class Session.",
    };
  }
  return { ok: true, scope: provided[0] };
}

// ---------------------------------------------------------------------------
// Upload validation — SECURITY_PLAN.md §8's own explicit rules, reused
// verbatim (not invented): extension allow-list per context, size limits
// per context (10MB documents / 5MB images). "Optionally .zip" is
// explicitly conditional on being "explicitly enabled for a context" —
// it isn't enabled here, so it's excluded. No restriction exists for
// `link`/`video` material types since neither ever uploads a file
// (external_url only, per the table's own materials_file_or_link CHECK).

const DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx"] as const;
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

export const MATERIAL_ALLOWED_EXTENSIONS: readonly string[] = [
  ...DOCUMENT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
];

export const MATERIAL_MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MATERIAL_MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MATERIAL_MAX_DOCUMENT_SIZE_LABEL = "10 MB";
export const MATERIAL_MAX_IMAGE_SIZE_LABEL = "5 MB";

export function getFileExtension(fileName: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

function extensionCategory(extension: string): "document" | "image" | null {
  if ((DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) return "document";
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(extension)) return "image";
  return null;
}

export const MATERIAL_FILE_TYPE_ERROR = `Unsupported file type. Allowed: ${MATERIAL_ALLOWED_EXTENSIONS.join(", ")}.`;

export function isMaterialExtensionAllowed(fileName: string): boolean {
  return extensionCategory(getFileExtension(fileName)) !== null;
}

export function materialFileSizeLimitBytes(fileName: string): number | null {
  const category = extensionCategory(getFileExtension(fileName));
  if (category === "document") return MATERIAL_MAX_DOCUMENT_SIZE_BYTES;
  if (category === "image") return MATERIAL_MAX_IMAGE_SIZE_BYTES;
  return null;
}

export function materialFileSizeLimitLabel(fileName: string): string {
  const category = extensionCategory(getFileExtension(fileName));
  if (category === "image") return MATERIAL_MAX_IMAGE_SIZE_LABEL;
  return MATERIAL_MAX_DOCUMENT_SIZE_LABEL;
}

export function isMaterialFileSizeAllowed(
  fileName: string,
  sizeInBytes: number,
): boolean {
  const limit = materialFileSizeLimitBytes(fileName);
  return limit !== null && sizeInBytes <= limit;
}

export function materialFileSizeTooLargeError(fileName: string): string {
  return `File is too large. Maximum allowed size is ${materialFileSizeLimitLabel(fileName)}.`;
}

// ---------------------------------------------------------------------------
// MIME sniffing — SECURITY_PLAN.md §8: "confirm the content matches the
// claimed extension" from the actual file bytes, never the trusted
// Content-Type header alone. A small, explicit magic-byte table for
// exactly the allow-listed extensions above — no new dependency, since
// this is a short, deterministic, fixed list (file-type-sniffing npm
// packages exist, but adding one for 7 known signatures is unwarranted
// here). docx/pptx/xlsx and zip share the same outer ZIP container
// signature (PK\x03\x04) at the application layer — this only proves
// "well-formed enough to be one of the Office Open XML formats", which is
// the same guarantee any ZIP-signature check gives; it does not
// distinguish docx from pptx from xlsx by magic bytes alone, which no
// lightweight signature check can do (all three share one container
// format) — the claimed extension plus this container check together are
// the same strength guarantee SECURITY_PLAN.md §8 asks for.

type SignatureCheck = (bytes: Uint8Array) => boolean;

function bytesStartWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy .doc/.ppt/.xls
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // .docx/.pptx/.xlsx (Office Open XML)

const SIGNATURE_CHECKS: Record<string, SignatureCheck> = {
  pdf: (b) => bytesStartWith(b, [0x25, 0x50, 0x44, 0x46]), // %PDF
  doc: (b) => bytesStartWith(b, OLE2_SIGNATURE),
  ppt: (b) => bytesStartWith(b, OLE2_SIGNATURE),
  xls: (b) => bytesStartWith(b, OLE2_SIGNATURE),
  docx: (b) => bytesStartWith(b, ZIP_SIGNATURE),
  pptx: (b) => bytesStartWith(b, ZIP_SIGNATURE),
  xlsx: (b) => bytesStartWith(b, ZIP_SIGNATURE),
  jpg: (b) => bytesStartWith(b, [0xff, 0xd8, 0xff]),
  jpeg: (b) => bytesStartWith(b, [0xff, 0xd8, 0xff]),
  png: (b) => bytesStartWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  webp: (b) =>
    bytesStartWith(b, [0x52, 0x49, 0x46, 0x46]) && // "RIFF"
    b.length >= 12 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50, // "WEBP"
};

export const MATERIAL_FILE_CONTENT_MISMATCH_ERROR =
  "This file's content does not match its extension.";

/** The first 12 bytes are enough to evaluate every signature above. */
export function matchesMaterialFileSignature(
  fileName: string,
  bytes: Uint8Array,
): boolean {
  const check = SIGNATURE_CHECKS[getFileExtension(fileName)];
  if (!check) return false;
  return check(bytes);
}

// ---------------------------------------------------------------------------
// Storage path — deterministic, server-generated, same discipline as
// lib/domain/students.ts's buildStudentDocumentPath: the caller never
// supplies or controls the path itself; only the original filename
// contributes a sanitized cosmetic suffix. The leading `{scopeType}/
// {scopeId}/` segments are a trusted-identifier prefix Storage RLS parses
// at INSERT time (supabase/migrations/20260101000027_materials_storage.sql)
// — needed only because no `materials` row exists yet to join against at
// that point; every other operation authorizes through the real metadata
// row, never the path alone (SECURITY_PLAN.md §8's own "storage paths must
// not be the primary authorization mechanism" principle).

export function buildMaterialObjectPath(
  scope: MaterialScope,
  objectId: string,
  originalName: string,
): string {
  return `${scope.type}/${scope.id}/${objectId}-${sanitizeFileNameForStorage(originalName)}`;
}

const MATERIAL_OBJECT_ID_PREFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

/** Recovers the (sanitized) original filename from a stored path, for display only. */
export function materialDisplayFileName(filePath: string): string {
  const lastSegment = filePath.split("/").pop() ?? filePath;
  return lastSegment.replace(MATERIAL_OBJECT_ID_PREFIX, "") || lastSegment;
}

// ---------------------------------------------------------------------------
// Student access — approved Phase 15 business decision (not FR-71's own
// literal text, which left this undefined): "active enrollment" means the
// project's own existing "operational/student-active" status grouping
// (supabase/migrations/20260101000025_enrollment_batch_integrity_
// constraints.sql's own term) — enrolled/active/on_hold/completed — plus
// the explicit decision that a completed enrollment retains its own
// materials access. lead/applicant (not yet in the learning-delivery
// lifecycle) and withdrawn/cancelled (historical/terminal) are excluded.
// This constant exists for documentation/consistency with the RLS
// migration (20260101000026) that enforces the real rule — application
// queries rely on that RLS, never re-deriving this filter themselves (same
// "RLS is the actual authorization boundary" discipline every prior
// phase's Student read path already uses).
export const MATERIAL_ACTIVE_ENROLLMENT_STATUSES = [
  "enrolled",
  "active",
  "on_hold",
  "completed",
] as const;

// ---------------------------------------------------------------------------
// Signed URL expiry — engineering default, not a business rule (no
// duration is defined anywhere in requirements). Centralized here as the
// one named constant every signed-URL call site uses; changing it later
// needs no migration, since nothing persists a signed URL as canonical
// data (lib/data/materials.ts only ever stores the stable file_path).
export const MATERIAL_SIGNED_URL_EXPIRY_SECONDS = 300;
