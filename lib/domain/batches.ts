/**
 * Pure Batch-management domain logic — no I/O. Mirrors the pattern
 * established by lib/domain/programs.ts: only the statuses/enums the
 * schema's own CHECK constraints actually allow
 * (supabase/migrations/20260101000005_catalog_tables.sql), nothing
 * invented. There is no Batch business code/identifier in the schema
 * (unlike programs.program_code) — batches are identified by UUID `id`
 * and a free-text `name` only; REQUIREMENTS.md FR-22 lists Batch fields
 * without mentioning a code, confirming this is intentional, not a gap.
 */

// batches.status CHECK: ('draft', 'upcoming', 'active', 'completed',
// 'cancelled', 'archived') — matches REQUIREMENTS.md FR-23's documented
// lifecycle exactly. No transition-order enforcement is implemented: the
// schema has no trigger/constraint restricting status changes, and no
// documented business rule requires one (same free-selection precedent as
// Program/Student/Trainer status controls).
export const BATCH_STATUSES = [
  "draft",
  "upcoming",
  "active",
  "completed",
  "cancelled",
  "archived",
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export function isBatchStatus(value: unknown): value is BatchStatus {
  return (
    typeof value === "string" && (BATCH_STATUSES as readonly string[]).includes(value)
  );
}

// batches.delivery_mode has the exact same CHECK constraint as
// programs.delivery_mode ('online' | 'in_person' | 'hybrid') — re-exported
// rather than redeclared, same reuse pattern as
// lib/domain/trainers.ts re-exporting phone helpers from students.
export { DELIVERY_MODES, isDeliveryMode, type DeliveryMode } from "@/lib/domain/programs";

// ---------------------------------------------------------------------------
// days_of_week — a plain `text[]` with no CHECK constraint (DATABASE_SCHEMA.md
// shows `{sat,sun}` only as an illustrative example, not an enforced enum).
// Represented in the form as one comma-separated text field, parsed into an
// array — the exact same "no controlled vocabulary exists, so don't invent
// one" reasoning and pattern as trainers.specialization
// (parseSpecializationInput/formatSpecializationForDisplay).

export function parseDaysOfWeekInput(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0),
    ),
  );
}

export function formatDaysOfWeekForDisplay(values: string[]): string {
  return values.join(", ");
}

// ---------------------------------------------------------------------------
// Date-range validation — batches.expected_end_date is nullable and has no
// DB-level check against start_date, but "an end date before the start
// date" is a logically-required rule (REQUIREMENTS.md item 8 in the Phase 8
// spec), not a fabricated one. Plain ISO "YYYY-MM-DD" string comparison —
// lexicographic ordering matches chronological ordering for this format,
// so no Date object / timezone conversion is needed.

export function isValidDateRange(
  startDate: string,
  expectedEndDate: string | null,
): boolean {
  if (!expectedEndDate) return true;
  return expectedEndDate >= startDate;
}
