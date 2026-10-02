/**
 * Pure Attendance domain logic — no I/O. Mirrors lib/domain/class-sessions.ts's
 * pattern: only the values the schema's own CHECK constraint actually allows
 * (attendance.status, supabase/migrations/20260101000008_academic_tables.sql),
 * matching REQUIREMENTS.md FR-61's documented status set exactly
 * (Present/Absent/Late/Excused). Nothing invented — no additional status
 * values, no attendance-percentage formula here (that is computed entirely
 * in SQL by the pre-existing student_attendance_summary view, per FR-62 —
 * "computed on read ... not manually maintained"; duplicating that formula
 * in TypeScript would create a second source of truth for it).
 */

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return (
    typeof value === "string" &&
    (ATTENDANCE_STATUSES as readonly string[]).includes(value)
  );
}

// attendance.marked_by_type / attendance_audit.changed_by_type's own CHECK
// constraint only allows these two values — super_admin is treated as
// "admin" for this polymorphic marker (lib/auth/session.ts's
// getCurrentUserContext() already resolves both admin and super_admin
// against the `admins` table for profileId, so this mapping is consistent
// with that existing convention, not a new one).
export type AttendanceMarkedByType = "trainer" | "admin";

export function markedByTypeForRole(
  role: "super_admin" | "admin" | "trainer" | "student",
): AttendanceMarkedByType | null {
  if (role === "admin" || role === "super_admin") return "admin";
  if (role === "trainer") return "trainer";
  return null;
}
