/**
 * Pure Program-management domain logic — no I/O. Mirrors the pattern
 * established by lib/domain/students.ts and lib/domain/trainers.ts: only
 * the statuses/enums the schema's own CHECK constraints actually allow
 * (supabase/migrations/20260101000005_catalog_tables.sql), nothing invented.
 */

// programs.status CHECK: ('draft', 'active', 'inactive', 'archived').
export const PROGRAM_STATUSES = ["draft", "active", "inactive", "archived"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export function isProgramStatus(value: unknown): value is ProgramStatus {
  return (
    typeof value === "string" && (PROGRAM_STATUSES as readonly string[]).includes(value)
  );
}

// programs.duration_unit CHECK: ('hours', 'days', 'weeks', 'months').
export const DURATION_UNITS = ["hours", "days", "weeks", "months"] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export function isDurationUnit(value: unknown): value is DurationUnit {
  return (
    typeof value === "string" && (DURATION_UNITS as readonly string[]).includes(value)
  );
}

// programs.delivery_mode CHECK: ('online', 'in_person', 'hybrid').
export const DELIVERY_MODES = ["online", "in_person", "hybrid"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export function isDeliveryMode(value: unknown): value is DeliveryMode {
  return (
    typeof value === "string" && (DELIVERY_MODES as readonly string[]).includes(value)
  );
}

/**
 * company_settings.program_code_pattern (REQUIREMENTS.md §7 item 1 /
 * DATABASE_SCHEMA.md "Program Code") is an admin-configured regex a Program
 * code must match; it is optional and currently unset for every real
 * deployment (there is no Settings UI to configure it yet — that ships in a
 * later phase), so this only ever activates once the column actually holds
 * a value. A pattern an admin saved via direct DB access could still be
 * invalid regex — that must never crash or silently block program creation,
 * so this returns false rather than throwing, and the caller treats "not
 * valid regex" the same as "not configured" (logging the misconfiguration
 * server-side instead).
 */
export function isValidRegexPattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export function matchesProgramCodePattern(code: string, pattern: string): boolean {
  return new RegExp(pattern).test(code);
}
