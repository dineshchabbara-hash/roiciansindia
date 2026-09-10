/**
 * Pure trainer-management domain logic — no I/O. Phone normalization and
 * duplicate-matching share the exact same rules as Student Management
 * (lib/domain/students.ts) rather than re-implementing them: this module
 * imports normalizeInternationalPhone/getPhoneCountry/DEFAULT_PHONE_COUNTRY
 * from there instead of duplicating them, per the Phase 6 instruction to
 * reuse the Phase 5 phone architecture.
 *
 * Trainer duplicate detection only has two identifiers to compare — email
 * and phone (trainers have no date-of-birth field), unlike students' third
 * name+DOB rule.
 */

import {
  normalizeInternationalPhone,
  DEFAULT_PHONE_COUNTRY,
} from "@/lib/domain/students";

export { normalizeInternationalPhone, DEFAULT_PHONE_COUNTRY };
export { getPhoneCountry } from "@/lib/domain/students";

// The trainers table's actual CHECK constraint
// (supabase/migrations/20260101000004_identity_tables.sql) only allows
// 'active' | 'inactive' — there is no 'archived' status for trainers,
// unlike students. Implementing only what the schema actually supports,
// per the Phase 6 instructions not to invent a new status model.
export const TRAINER_STATUSES = ["active", "inactive"] as const;
export type TrainerStatus = (typeof TRAINER_STATUSES)[number];

export function isTrainerStatus(value: unknown): value is TrainerStatus {
  return (
    typeof value === "string" && (TRAINER_STATUSES as readonly string[]).includes(value)
  );
}

export type TrainerDuplicateCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
};

export type TrainerDuplicateMatch = {
  candidate: TrainerDuplicateCandidate;
  reasons: TrainerDuplicateMatchReason[];
};

export type TrainerDuplicateMatchReason = "phone" | "email";

export type NewTrainerInput = {
  email: string;
  phone: string | null;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Compares one candidate new trainer against one existing trainer and
 * returns every rule that matched. Mirrors
 * lib/domain/students.ts's findDuplicateReasons, minus the name+DOB rule
 * (trainers have no date-of-birth field to match on).
 */
export function findTrainerDuplicateReasons(
  input: NewTrainerInput,
  existing: TrainerDuplicateCandidate,
): TrainerDuplicateMatchReason[] {
  const reasons: TrainerDuplicateMatchReason[] = [];

  if (input.phone && existing.phone) {
    // Both sides are already canonical E.164 by the time this runs (the
    // validation schema normalizes phone before this is ever called), so
    // no default-country guess is needed here for either side, unlike the
    // student version which has to account for legacy bare-digit values.
    const inputPhone = normalizeInternationalPhone(input.phone, DEFAULT_PHONE_COUNTRY);
    const existingPhone = normalizeInternationalPhone(
      existing.phone,
      DEFAULT_PHONE_COUNTRY,
    );
    if (inputPhone && existingPhone && inputPhone === existingPhone) {
      reasons.push("phone");
    }
  }

  if (normalizeEmail(input.email) === normalizeEmail(existing.email)) {
    reasons.push("email");
  }

  return reasons;
}

export function findTrainerDuplicateMatches(
  input: NewTrainerInput,
  candidates: TrainerDuplicateCandidate[],
): TrainerDuplicateMatch[] {
  return candidates
    .map((candidate) => ({
      candidate,
      reasons: findTrainerDuplicateReasons(input, candidate),
    }))
    .filter((match) => match.reasons.length > 0);
}

export const TRAINER_DUPLICATE_REASON_LABELS: Record<
  TrainerDuplicateMatchReason,
  string
> = {
  phone: "Same phone number",
  email: "Same email address",
};

// ---------------------------------------------------------------------------
// Specialization — stored as text[]; the form collects it as one
// comma-separated text field rather than a multi-select, since there is no
// existing controlled vocabulary/table of skills to select from (adding one
// would be inventing a new schema concept beyond this phase's scope).

export function parseSpecializationInput(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );
}

export function formatSpecializationForDisplay(values: string[]): string {
  return values.join(", ");
}
