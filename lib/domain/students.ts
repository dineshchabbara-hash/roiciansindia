/**
 * Pure student-management domain logic — no I/O, no Supabase import.
 * Duplicate-detection rules per REQUIREMENTS.md FR-14, deliberately
 * conservative: every rule here is chosen for a low false-positive rate,
 * even at the cost of missing some true duplicates (e.g. the same phone
 * number entered with vs. without a country code is NOT treated as a
 * match — guessing at country codes is unreliable and risks false
 * positives, which is worse than an occasional missed warning here).
 */

export type DuplicateCandidate = {
  id: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  dateOfBirth: string | null;
};

export type DuplicateMatch = {
  candidate: DuplicateCandidate;
  reasons: DuplicateMatchReason[];
};

export type DuplicateMatchReason = "phone" | "email" | "name_and_dob";

export type NewStudentInput = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  dateOfBirth: string | null;
};

/** Strips spaces, dashes, and parentheses only — no country-code handling. */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, "");
}

function normalizeName(first: string, last: string): string {
  return `${first} ${last}`.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Compares one candidate new student against one existing student and
 * returns every rule that matched (a candidate can match on more than one
 * rule at once, e.g. same phone AND same name+DOB).
 */
export function findDuplicateReasons(
  input: NewStudentInput,
  existing: DuplicateCandidate,
): DuplicateMatchReason[] {
  const reasons: DuplicateMatchReason[] = [];

  if (normalizePhone(input.phone) === normalizePhone(existing.phone)) {
    reasons.push("phone");
  }

  if (input.email && existing.email) {
    if (normalizeEmail(input.email) === normalizeEmail(existing.email)) {
      reasons.push("email");
    }
  }

  // Name-only is never sufficient — always requires a second matching
  // identifier (here, date of birth, only when both sides have one).
  if (input.dateOfBirth && existing.dateOfBirth) {
    const sameName =
      normalizeName(input.firstName, input.lastName) ===
      normalizeName(existing.firstName, existing.lastName);
    const sameDob = input.dateOfBirth === existing.dateOfBirth;
    if (sameName && sameDob) {
      reasons.push("name_and_dob");
    }
  }

  return reasons;
}

export function findDuplicateMatches(
  input: NewStudentInput,
  candidates: DuplicateCandidate[],
): DuplicateMatch[] {
  return candidates
    .map((candidate) => ({ candidate, reasons: findDuplicateReasons(input, candidate) }))
    .filter((match) => match.reasons.length > 0);
}

export const DUPLICATE_REASON_LABELS: Record<DuplicateMatchReason, string> = {
  phone: "Same phone number",
  email: "Same email address",
  name_and_dob: "Same name and date of birth",
};

// ---------------------------------------------------------------------------
// Student ID / status helpers

export const STUDENT_STATUSES = ["active", "inactive", "archived"] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export function isStudentStatus(value: unknown): value is StudentStatus {
  return (
    typeof value === "string" && (STUDENT_STATUSES as readonly string[]).includes(value)
  );
}

/** Formats a raw sequence number with the configured prefix (empty by default). */
export function formatStudentCode(prefix: string, sequenceValue: number): string {
  return `${prefix}${sequenceValue}`;
}

// ---------------------------------------------------------------------------
// Document storage path — deterministic, server-generated. The caller never
// supplies (or controls) the path itself; only the original filename is
// used, and only for a cosmetic suffix after sanitization. Authorization for
// the object comes entirely from the Storage RLS policy (is_admin_or_super()),
// never from the shape of this path.

export function sanitizeFileNameForStorage(originalName: string): string {
  const base = originalName.trim().slice(-100);
  return (
    base
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      // Collapse any run of 2+ dots (e.g. from "../../") — a single "."
      // only ever legitimately separates a name from its extension.
      .replace(/\.{2,}/g, "_") || "file"
  );
}

export function buildStudentDocumentPath(
  studentId: string,
  objectId: string,
  originalName: string,
): string {
  return `${studentId}/${objectId}-${sanitizeFileNameForStorage(originalName)}`;
}
