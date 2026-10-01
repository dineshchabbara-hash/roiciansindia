/**
 * Pure Class Session domain logic — no I/O. Mirrors lib/domain/batches.ts's
 * pattern: only the values the schema's own CHECK constraint actually allows
 * (class_sessions.status, supabase/migrations/20260101000008_academic_tables.sql),
 * matching REQUIREMENTS.md FR-60's documented status set exactly. Nothing
 * invented — no recurrence, no cancellation workflow beyond this status
 * value, no duration/collision logic (see the Phase 12 report for why).
 */

export const CLASS_SESSION_STATUSES = [
  "scheduled",
  "completed",
  "cancelled",
  "rescheduled",
] as const;
export type ClassSessionStatus = (typeof CLASS_SESSION_STATUSES)[number];

export function isClassSessionStatus(value: unknown): value is ClassSessionStatus {
  return (
    typeof value === "string" &&
    (CLASS_SESSION_STATUSES as readonly string[]).includes(value)
  );
}

// start_time/end_time are both nullable "HH:MM" (or "HH:MM:SS") strings with
// no DB-level check against each other, but "an end time before the start
// time" is a logically-required rule (same reasoning as
// lib/domain/batches.ts's isValidDateRange for Batch start/end dates), not a
// fabricated one. Plain string comparison is valid here because both values
// share the same "HH:MM..." zero-padded 24-hour format.
export function isValidTimeRange(
  startTime: string | null,
  endTime: string | null,
): boolean {
  if (!startTime || !endTime) return true;
  return endTime > startTime;
}
