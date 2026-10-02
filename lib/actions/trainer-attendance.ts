"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { markMyAttendanceForSession } from "@/lib/data/trainer-portal";
import { parseAttendanceRosterFormData } from "@/lib/validation/attendance";

/**
 * Trainer Portal Attendance server action (Phase 13) — a separate module
 * from lib/actions/attendance.ts (Admin), the same split Phase 11/12 already
 * established between Admin and Trainer actions. The authorization check
 * here is "is this caller actually a Trainer"; every mutation goes through
 * markMyAttendanceForSession (lib/data/trainer-portal.ts), which
 * independently re-derives the eligible roster from the caller's own
 * assigned batch (trainer_visible_enrollments()) and re-verifies the
 * batch+session relationship via getMySession before writing — never
 * trusting the role or a submitted enrollment/student id alone.
 */

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type AttendanceMarkFormState = {
  formError?: string;
  success?: boolean;
  summary?: { marked: number; corrected: number; ignored: number };
};

export async function markMyAttendanceAction(
  batchId: string,
  sessionId: string,
  _prevState: AttendanceMarkFormState,
  formData: FormData,
): Promise<AttendanceMarkFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "trainer") {
    return { formError: NOT_AUTHORIZED };
  }

  const entries = parseAttendanceRosterFormData(formData);
  const result = await markMyAttendanceForSession(batchId, sessionId, entries);
  if (!result.ok) {
    return { formError: result.error };
  }

  revalidatePath(`/trainer/batches/${batchId}/sessions/${sessionId}/attendance`);
  return { success: true, summary: result.data };
}
