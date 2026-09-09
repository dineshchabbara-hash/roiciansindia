/**
 * Pure student-management domain logic — no I/O, no Supabase import (the
 * one exception being libphonenumber-js, a pure computation library with no
 * I/O of its own — see normalizeInternationalPhone() below).
 *
 * Duplicate-detection rules per REQUIREMENTS.md FR-14, deliberately
 * conservative: every rule here is chosen for a low false-positive rate,
 * even at the cost of missing some true duplicates. Phone numbers are the
 * one exception to "no guessing": normalizeInternationalPhone() recognizes
 * genuinely valid numbers for whichever country is given (or implied by a
 * leading "+"), via libphonenumber-js's real numbering-plan data — never a
 * hand-rolled length guess — and rejects, rather than guesses at, anything
 * that isn't a real number for that country.
 */

import {
  parsePhoneNumberFromString,
  isSupportedCountry,
  type CountryCode,
} from "libphonenumber-js";
import { DEFAULT_PHONE_COUNTRY } from "@/lib/domain/phone-countries";

export { DEFAULT_PHONE_COUNTRY };

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

/**
 * The single source of truth for turning a user-typed phone number into
 * canonical E.164 (`+<country code><national number>`) — used for create,
 * edit, and duplicate detection alike (REQUIREMENTS.md FR-14 correction).
 *
 * `defaultCountry` is only a fallback hint for a number with no leading
 * "+" (e.g. a bare "9876543210" typed while "India" is selected in the
 * form) — a number that already starts with "+" is parsed as fully
 * international regardless of it. Validity (including how many subscriber
 * digits are correct) is real numbering-plan data from libphonenumber-js,
 * never a hand-rolled digit count — a 10-digit assumption is only correct
 * for some countries. Returns null, never a guess, for anything that isn't
 * a genuinely valid number: an unrecognized country, a number with the
 * wrong digit count for its country, or non-numeric input.
 */
export function normalizeInternationalPhone(
  raw: string,
  defaultCountry?: string,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hint: CountryCode | undefined =
    defaultCountry && isSupportedCountry(defaultCountry) ? defaultCountry : undefined;

  // Without a leading "+", a bare number is only interpretable given a
  // country hint — otherwise there's nothing to guess from.
  if (!trimmed.startsWith("+") && !hint) return null;

  const phoneNumber = parsePhoneNumberFromString(trimmed, hint);
  if (!phoneNumber || !phoneNumber.isValid()) return null;

  return phoneNumber.number;
}

/** The ISO country a canonical E.164 number belongs to, or null if unparseable. */
export function getPhoneCountry(e164Phone: string): CountryCode | null {
  const phoneNumber = parsePhoneNumberFromString(e164Phone);
  return phoneNumber?.country ?? null;
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

  // The new input is always already canonical E.164 by this point (the
  // validation schema normalizes it before this ever runs), so the default
  // country hint below only matters for `existing.phone` — a candidate
  // stored before international support existed may still be a bare
  // digit-only legacy value, which DEFAULT_PHONE_COUNTRY (India) resolves
  // the same way the earlier India-only fix did. A candidate whose stored
  // phone doesn't parse at all is simply not matchable on phone (never a
  // crash, never a guessed match).
  const inputPhone = normalizeInternationalPhone(input.phone, DEFAULT_PHONE_COUNTRY);
  const existingPhone = normalizeInternationalPhone(
    existing.phone,
    DEFAULT_PHONE_COUNTRY,
  );
  if (inputPhone && existingPhone && inputPhone === existingPhone) {
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

// Real Phase 5 bug: no application-level file-size (or file-type) rule
// existed anywhere for student documents — Storage itself has no
// per-object limit configured, and uploadStudentDocumentAction only ever
// checked for a missing/empty file. The only thing actually capping upload
// size was Next.js's own default Server Action body limit (1MB — see
// serverActions.bodySizeLimit in next.config.ts, now raised to 10MB for
// this same reason). That default is a framework transport limit, not an
// app validation rule: exceeding it makes Next reject the request before
// uploadStudentDocumentAction ever runs, bypassing every try/catch inside
// it — which is what crashed the Student Profile page to its error
// boundary for a normal real-world file. This constant is the app's own
// validation ceiling, kept safely under the raised 10MB transport limit
// (leaving headroom for multipart overhead and the action's other bound
// arguments, per Next's own documented guidance on the two not being the
// same number) — the specific figure is a technical safety margin chosen
// to eliminate the crash, not an asserted business/product policy on
// document size; there is still no file*type* restriction of any kind.
export const MAX_DOCUMENT_FILE_SIZE_BYTES = 9_000_000; // 9 MB
export const MAX_DOCUMENT_FILE_SIZE_LABEL = "9 MB";
export const DOCUMENT_FILE_TOO_LARGE_ERROR = `File is too large. Maximum size is ${MAX_DOCUMENT_FILE_SIZE_LABEL}.`;

export function isDocumentFileSizeAllowed(sizeInBytes: number): boolean {
  return sizeInBytes <= MAX_DOCUMENT_FILE_SIZE_BYTES;
}

// A v4 UUID from crypto.randomUUID(), exactly as buildStudentDocumentPath
// above prefixes every stored object name with.
const DOCUMENT_OBJECT_ID_PREFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

/**
 * Recovers the (sanitized) original filename from a stored document path,
 * for display only — e.g. "student-1/3f9e...-passport.pdf" -> "passport.pdf".
 * Stripping the fixed-width UUID prefix (rather than splitting on the first
 * "-") is required because the original filename itself may contain "-".
 */
export function documentDisplayFileName(filePath: string): string {
  const lastSegment = filePath.split("/").pop() ?? filePath;
  return lastSegment.replace(DOCUMENT_OBJECT_ID_PREFIX, "") || lastSegment;
}

// ---------------------------------------------------------------------------
// Deterministic display timestamp — shared by every hydrated Client
// Component in Student Management that renders a created/updated-at value
// (student-notes-section.tsx, student-documents-section.tsx). Both used to
// call `new Date(iso).toLocaleString()` directly, which formats using the
// runtime's *default* locale and time zone — identical code, but a
// genuinely different result on the Node SSR pass vs. the browser's own
// locale/time zone during hydration (reproduced for real: server rendered
// "2026-09-09, 12:58:52 p.m.", the browser hydrated "9/9/2026, 12:58:52
// PM"). This is the same class of bug as the earlier Intl.DisplayNames
// country-name mismatch (see phone-countries.ts) — any locale- or
// time-zone-dependent API called identically on both sides can still
// legitimately disagree, since "identical code" isn't "identical runtime
// environment". Fixed the same way: never call a locale-dependent API at
// render time. This builds the string by hand from explicit UTC field
// accessors (getUTCFullYear() etc.) and a hardcoded month-name table —
// there is no Intl call and no dependency on either side's default locale
// or local time zone, so server and client always produce the same text
// for the same instant.
const MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** e.g. "9 Sep 2026, 12:58 UTC" — always UTC, always this exact shape. */
export function formatDisplayTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const day = date.getUTCDate();
  const month = MONTH_ABBREVIATIONS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = pad2(date.getUTCHours());
  const minutes = pad2(date.getUTCMinutes());
  return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}
