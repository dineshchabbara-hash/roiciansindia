/**
 * Pure Assignments & Submissions domain logic — no I/O. Mirrors
 * lib/domain/materials.ts's own pattern: only values the schema's own CHECK
 * constraints actually allow (assignments.status, assignment_submissions.
 * status — supabase/migrations/20260101000008_academic_tables.sql), nothing
 * invented. Assignments is a separate domain from Materials (different
 * scope shape, different ownership rules) — this file does not import from
 * or defer to lib/domain/materials.ts; the two share a *policy*
 * (SECURITY_PLAN.md §8's file-upload rules), not code.
 */

import { sanitizeFileNameForStorage } from "@/lib/domain/students";

export const ASSIGNMENT_STATUSES = ["active", "closed"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const SUBMISSION_STATUSES = [
  "not_submitted",
  "submitted",
  "late",
  "reviewed",
  "resubmission_requested",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export function isSubmissionStatus(value: unknown): value is SubmissionStatus {
  return (
    typeof value === "string" &&
    (SUBMISSION_STATUSES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Due date / late determination — REQUIREMENTS.md FR-82's own lifecycle
// ("Not Submitted -> Submitted/Late -> Reviewed -> Resubmission Requested")
// is the only primary-source signal for when 'late' applies, and it reads
// as a single submission-time fork between the two already-existing enum
// values, not a separate manually-set-by-Trainer status. No grace period,
// late penalty, auto-rejection, or timezone policy is defined anywhere in
// requirements (approved Phase 16 decision: do not invent one) — a
// submission is NEVER blocked after the due date, only labeled 'late'
// instead of 'submitted'. `due_date` is a plain `date` column (no time
// component), so this compares calendar dates only, using the server's own
// current UTC date — documented as a known limitation (no per-batch/
// student timezone is read anywhere in this comparison), not a business
// rule.
export function resolveSubmissionStatusForNow(
  dueDate: string,
  now: Date = new Date(),
): "submitted" | "late" {
  const today = now.toISOString().slice(0, 10);
  return today > dueDate ? "late" : "submitted";
}

// ---------------------------------------------------------------------------
// Marks — assignments.max_marks is an informational ceiling (nullable,
// DB-enforced >= 0 only, no DB check tying it to assignment_submissions.
// marks). FR-45/FR-53 ("see trainer feedback/marks" / "add feedback/marks")
// are the only primary-source authorization for this field at all — no
// rubric, weighting, or pass/fail threshold is defined, so none is built.
// This bound is an application-layer safeguard against an obviously
// malformed review (marks exceeding the assignment's own stated ceiling),
// not a schema rule.
export function isMarksWithinCeiling(marks: number, maxMarks: number | null): boolean {
  if (marks < 0) return false;
  if (maxMarks === null) return true;
  return marks <= maxMarks;
}

// ---------------------------------------------------------------------------
// Upload validation — SECURITY_PLAN.md §8's own explicit rules, the same
// policy lib/domain/materials.ts already reuses verbatim for Materials:
// extension allow-list, size limits (10MB documents / 5MB images), content-
// byte signature check. Duplicated here (not imported from
// lib/domain/materials.ts) so this domain module has no dependency on
// Materials' own internals — the two reuse the same SECURITY_PLAN policy,
// not each other's code.

const DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx"] as const;
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

export const ASSIGNMENT_ALLOWED_EXTENSIONS: readonly string[] = [
  ...DOCUMENT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
];

export const ASSIGNMENT_MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ASSIGNMENT_MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ASSIGNMENT_MAX_DOCUMENT_SIZE_LABEL = "10 MB";
export const ASSIGNMENT_MAX_IMAGE_SIZE_LABEL = "5 MB";

export function getFileExtension(fileName: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

function extensionCategory(extension: string): "document" | "image" | null {
  if ((DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) return "document";
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(extension)) return "image";
  return null;
}

export const ASSIGNMENT_FILE_TYPE_ERROR = `Unsupported file type. Allowed: ${ASSIGNMENT_ALLOWED_EXTENSIONS.join(", ")}.`;

export function isAssignmentExtensionAllowed(fileName: string): boolean {
  return extensionCategory(getFileExtension(fileName)) !== null;
}

export function assignmentFileSizeLimitBytes(fileName: string): number | null {
  const category = extensionCategory(getFileExtension(fileName));
  if (category === "document") return ASSIGNMENT_MAX_DOCUMENT_SIZE_BYTES;
  if (category === "image") return ASSIGNMENT_MAX_IMAGE_SIZE_BYTES;
  return null;
}

export function assignmentFileSizeLimitLabel(fileName: string): string {
  const category = extensionCategory(getFileExtension(fileName));
  if (category === "image") return ASSIGNMENT_MAX_IMAGE_SIZE_LABEL;
  return ASSIGNMENT_MAX_DOCUMENT_SIZE_LABEL;
}

export function isAssignmentFileSizeAllowed(
  fileName: string,
  sizeInBytes: number,
): boolean {
  const limit = assignmentFileSizeLimitBytes(fileName);
  return limit !== null && sizeInBytes <= limit;
}

export function assignmentFileSizeTooLargeError(fileName: string): string {
  return `File is too large. Maximum allowed size is ${assignmentFileSizeLimitLabel(fileName)}.`;
}

// MIME sniffing — same honest truth table as lib/domain/materials.ts
// (audited there, not re-audited here): the OLE2 trio (doc/ppt/xls) shares
// one signature, the OOXML trio (docx/pptx/xlsx) shares one signature, so
// this proves "well-formed container of that family", never which specific
// format/application produced it or an exact Office file subtype.

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

export const ASSIGNMENT_FILE_CONTENT_MISMATCH_ERROR =
  "This file's content does not match its extension.";

/** The first 12 bytes are enough to evaluate every signature above. */
export function matchesAssignmentFileSignature(
  fileName: string,
  bytes: Uint8Array,
): boolean {
  const check = SIGNATURE_CHECKS[getFileExtension(fileName)];
  if (!check) return false;
  return check(bytes);
}

// ---------------------------------------------------------------------------
// Storage paths — deterministic, server-generated (see
// supabase/migrations/20260101000029_assignments_storage.sql for the
// Storage RLS that parses these same two shapes). The caller never supplies
// or controls the path itself; only the original filename contributes a
// sanitized cosmetic suffix (lib/domain/students.ts's own
// sanitizeFileNameForStorage, reused verbatim — same discipline as
// lib/domain/materials.ts's buildMaterialObjectPath).
//
// Assignment attachment: `{assignmentId}/{objectId}-{name}` — the
// assignment row (and its real batch_id/trainer_id) already exists by
// upload time in this phase's own create flow, so the Storage INSERT
// policy can trust this path's first segment by joining it to the real
// `assignments` table directly (never the path's text alone as the actual
// authorization — see the migration's own header comment).
//
// Student submission: `{assignmentId}/{studentId}/{objectId}-{name}` — a
// submission row may not exist yet at the Student's first-ever upload (the
// identical chicken-and-egg timing Materials solved for Trainer uploads),
// so the Storage INSERT policy trusts this path's encoded identifiers,
// independently re-verified against the real assignments/enrollments
// relationship — never the path text alone either.

export function buildAssignmentAttachmentPath(
  assignmentId: string,
  objectId: string,
  originalName: string,
): string {
  return `${assignmentId}/${objectId}-${sanitizeFileNameForStorage(originalName)}`;
}

export function buildAssignmentSubmissionPath(
  assignmentId: string,
  studentId: string,
  objectId: string,
  originalName: string,
): string {
  return `${assignmentId}/${studentId}/${objectId}-${sanitizeFileNameForStorage(originalName)}`;
}

const ASSIGNMENT_OBJECT_ID_PREFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

/** Recovers the (sanitized) original filename from a stored path, for display only. */
export function assignmentDisplayFileName(filePath: string): string {
  const lastSegment = filePath.split("/").pop() ?? filePath;
  return lastSegment.replace(ASSIGNMENT_OBJECT_ID_PREFIX, "") || lastSegment;
}

// ---------------------------------------------------------------------------
// Signed URL expiry — engineering default, not a business rule (no
// duration is defined anywhere in requirements), same reasoning and same
// value as lib/domain/materials.ts's own MATERIAL_SIGNED_URL_EXPIRY_SECONDS.
// Nothing persists a signed URL as canonical data, so changing this later
// needs no migration.
export const ASSIGNMENT_SIGNED_URL_EXPIRY_SECONDS = 300;
