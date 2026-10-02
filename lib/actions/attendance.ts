"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import { markedByTypeForRole } from "@/lib/domain/attendance";
import { markAttendanceForClassSession } from "@/lib/data/attendance";
import { parseAttendanceRosterFormData } from "@/lib/validation/attendance";

/**
 * Admin-facing Attendance server action (Phase 13). Re-checks
 * isAdminOrSuperAdmin() server-side before calling into
 * lib/data/attendance.ts, the same pattern lib/actions/class-sessions.ts
 * already establishes — the data layer additionally re-derives eligibility
 * from the session's own batch on every call, so this action never trusts
 * the submitted roster beyond what that re-derivation confirms.
 *
 * No general audit_logs entry is written here: attendance_audit
 * (supabase/migrations/20260101000008_academic_tables.sql) is the
 * purpose-built table REQUIREMENTS.md FR-63 already provides for this exact
 * change history, and lib/data/attendance.ts writes to it directly for every
 * status correction — writing a second, parallel entry into the general
 * audit_logs system would be the "second audit system" this phase's brief
 * says not to create, not an addition to it.
 */

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type AttendanceMarkFormState = {
  formError?: string;
  success?: boolean;
  summary?: { marked: number; corrected: number; ignored: number };
};

export async function markAttendanceAction(
  batchId: string,
  sessionId: string,
  _prevState: AttendanceMarkFormState,
  formData: FormData,
): Promise<AttendanceMarkFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }
  const actorType = markedByTypeForRole(ctx.role);
  if (!actorType || !ctx.profileId) {
    return { formError: NOT_AUTHORIZED };
  }

  const entries = parseAttendanceRosterFormData(formData);
  const result = await markAttendanceForClassSession(batchId, sessionId, entries, {
    id: ctx.profileId,
    type: actorType,
  });
  if (!result.ok) {
    return { formError: result.error };
  }

  revalidatePath(`/admin/batches/${batchId}/sessions/${sessionId}/attendance`);
  return { success: true, summary: result.data };
}
