import { z } from "zod";
import { ATTENDANCE_STATUSES } from "@/lib/domain/attendance";

// Same "blank means not provided" convention as
// lib/validation/class-sessions.ts / lib/validation/batches.ts.
const optionalTrimmed = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

// One roster row, as submitted from the attendance-marking form. enrollmentId
// here is only ever cross-checked against the server's own eligible-roster
// computation (getEligibleRosterForClassSession / getMyEligibleRosterForSession)
// before being trusted for a mutation — never used on its own to decide which
// student_id/batch_id gets written (see lib/actions/attendance.ts /
// lib/actions/trainer-attendance.ts). A row with no status selected means
// "leave this student unmarked for now" — status is therefore optional at
// the schema level, and the action layer filters out unselected rows before
// doing anything with them, rather than this schema rejecting them.
export const attendanceRosterEntrySchema = z.object({
  enrollmentId: z.string().uuid(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  notes: optionalTrimmed,
});

export type AttendanceRosterEntry = z.infer<typeof attendanceRosterEntrySchema>;

export const attendanceStatusOnlySchema = z.object({
  status: z.enum(ATTENDANCE_STATUSES),
});

// Parses the roster-marking form's FormData. Each eligible student renders
// as a `status__<enrollmentId>` select (blank value = "leave unmarked") and
// an optional `notes__<enrollmentId>` input — repeated field groups rather
// than a JSON blob, so the form keeps working with JS disabled, matching
// this project's existing Server Action + <form action> convention (see
// components/admin/class-sessions/class-session-form.tsx).
//
// A malformed individual row (e.g. a non-UUID enrollmentId from a tampered
// request) is silently dropped here rather than failing the whole
// submission — it cannot do anything further anyway, since every row that
// survives this parse is still cross-checked against the server's own
// eligible-roster computation before any mutation happens (the real
// security boundary; see lib/actions/attendance.ts /
// lib/actions/trainer-attendance.ts).
export function parseAttendanceRosterFormData(
  formData: FormData,
): AttendanceRosterEntry[] {
  const enrollmentIds = new Set<string>();
  for (const key of formData.keys()) {
    if (key.startsWith("status__")) {
      enrollmentIds.add(key.slice("status__".length));
    }
  }

  const entries: AttendanceRosterEntry[] = [];
  for (const enrollmentId of enrollmentIds) {
    const rawStatus = formData.get(`status__${enrollmentId}`);
    const rawNotes = formData.get(`notes__${enrollmentId}`);
    const statusValue =
      typeof rawStatus === "string" && rawStatus !== "" ? rawStatus : undefined;

    const parsed = attendanceRosterEntrySchema.safeParse({
      enrollmentId,
      status: statusValue,
      notes: typeof rawNotes === "string" ? rawNotes : null,
    });
    if (parsed.success) entries.push(parsed.data);
  }
  return entries;
}
