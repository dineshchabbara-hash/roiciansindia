import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

/**
 * Node-side setup/teardown for the Phase 13 (Attendance) live-data E2E suite
 * (e2e/phase13-attendance.spec.ts). A deliberately separate, self-contained
 * implementation from e2e/support/phase12-fixtures.ts, same reasoning as
 * that file's own header comment for why it doesn't reuse Phase 11's — each
 * phase's fixtures/markers must be independently auditable (Phase 13 task
 * brief §28). Only the environment check (hasRealSupabaseCredentials) is
 * re-exported, since it has no phase-specific behavior at all.
 *
 * This is intentionally NOT a .spec.ts file — Playwright would otherwise try
 * to run it as a test file itself.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export { hasRealSupabaseCredentials } from "./phase5-fixtures";

function adminClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing real Supabase credentials — call hasRealSupabaseCredentials() first.",
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

// Same double-failure-mode normalization as
// e2e/support/phase9-fixtures.ts's safely() — see its own doc comment.
async function safely<T = unknown>(
  operation: () => PromiseLike<{ data?: T | null; error: { message: string } | null }>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    const result = await operation();
    return { data: result.data ?? null, error: result.error };
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  }
}

export const PHASE13_E2E_EMAIL_DOMAIN = "phase13-e2e.internal.test";
export const PHASE13_E2E_PREFIX = "Phase13E2E";

export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export type Phase13DeleteResult = { ok: boolean; reason?: string };

// ---------------------------------------------------------------------------
// Admin login identity — full auth.users + user_roles('admin') + an admins
// row, same shape as e2e/support/phase12-fixtures.ts's own admin identity.

export type Phase13AdminIdentity = {
  authUserId: string;
  email: string;
  password: string;
  hasProfile: boolean;
};

export class Phase13PartialAdminIdentityError extends Error {
  partial: Phase13AdminIdentity;
  constructor(message: string, partial: Phase13AdminIdentity) {
    super(message);
    this.name = "Phase13PartialAdminIdentityError";
    this.partial = partial;
  }
}

export async function createPhase13AdminIdentity(
  tag: string,
): Promise<Phase13AdminIdentity> {
  const supabase = adminClient();
  const email = `phase13-e2e-admin-${tag.toLowerCase()}-${RUN_ID}@${PHASE13_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(`Failed to create admin identity (${tag}): ${error?.message}`);
  }
  const authUserId = data.user.id;

  let partial: Phase13AdminIdentity = { authUserId, email, password, hasProfile: false };

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: authUserId, role: "admin" }),
  );
  if (roleError) {
    throw new Phase13PartialAdminIdentityError(
      `Failed to assign admin role (auth user WAS already created): ${roleError.message}`,
      partial,
    );
  }

  const { error: profileError } = await safely(() =>
    supabase.from("admins").insert({
      auth_user_id: authUserId,
      first_name: PHASE13_E2E_PREFIX,
      last_name: "Admin",
      email,
      role_level: "admin",
    }),
  );
  if (profileError) {
    throw new Phase13PartialAdminIdentityError(
      `Failed to create admin profile (auth user + user_roles WERE already created): ${profileError.message}`,
      partial,
    );
  }
  partial = { ...partial, hasProfile: true };

  return partial;
}

export async function deletePhase13AdminIdentity(
  identity: Phase13AdminIdentity,
): Promise<Phase13DeleteResult> {
  const supabase = adminClient();

  if (identity.hasProfile) {
    const { error } = await safely(() =>
      supabase.from("admins").delete().eq("auth_user_id", identity.authUserId),
    );
    if (error) {
      return { ok: false, reason: `Could not delete admin profile: ${error.message}` };
    }
  }

  const { error: authError } = await safely<unknown>(() =>
    supabase.auth.admin.deleteUser(identity.authUserId),
  );
  if (authError) {
    return { ok: false, reason: `Could not delete auth user: ${authError.message}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Trainer Portal identity — a real login: auth.users + user_roles('trainer')
// + a trainers row, duplicated from e2e/support/phase12-fixtures.ts's own
// shape per this file's own header comment rather than imported across
// phases.

export type Phase13TrainerPortalIdentity = {
  authUserId: string;
  email: string;
  password: string;
  trainerId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase13PartialTrainerPortalIdentityError extends Error {
  partial: Phase13TrainerPortalIdentity;
  constructor(message: string, partial: Phase13TrainerPortalIdentity) {
    super(message);
    this.name = "Phase13PartialTrainerPortalIdentityError";
    this.partial = partial;
  }
}

export async function createPhase13TrainerPortalIdentity(
  tag: string,
): Promise<Phase13TrainerPortalIdentity> {
  const supabase = adminClient();
  const firstName = `${PHASE13_E2E_PREFIX}${tag}`;
  const lastName = "Trainer";
  const email = `phase13-e2e-trainer-${tag.toLowerCase()}-${RUN_ID}@${PHASE13_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(
      `Failed to create trainer portal identity (${tag}): ${error?.message}`,
    );
  }
  const authUserId = data.user.id;

  let partial: Phase13TrainerPortalIdentity = {
    authUserId,
    email,
    password,
    trainerId: null,
    firstName,
    lastName,
  };

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: authUserId, role: "trainer" }),
  );
  if (roleError) {
    throw new Phase13PartialTrainerPortalIdentityError(
      `Failed to assign trainer role (auth user WAS already created): ${roleError.message}`,
      partial,
    );
  }

  const { data: trainerRow, error: trainerError } = await safely<{ id: string }>(() =>
    supabase
      .from("trainers")
      .insert({
        auth_user_id: authUserId,
        first_name: firstName,
        last_name: lastName,
        email,
      })
      .select("id")
      .single(),
  );
  if (trainerError || !trainerRow) {
    throw new Phase13PartialTrainerPortalIdentityError(
      `Failed to create trainers row (auth user + user_roles WERE already created): ${trainerError?.message}`,
      partial,
    );
  }
  partial = { ...partial, trainerId: trainerRow.id };

  return partial;
}

export async function deletePhase13TrainerPortalIdentity(
  identity: Phase13TrainerPortalIdentity,
): Promise<Phase13DeleteResult> {
  const supabase = adminClient();

  if (identity.trainerId) {
    const { data: assignments, error: assignmentsError } = await safely(() =>
      supabase
        .from("batch_trainers")
        .select("id")
        .eq("trainer_id", identity.trainerId)
        .limit(1),
    );
    if (assignmentsError) {
      return {
        ok: false,
        reason: `Could not check batch_trainers dependents: ${assignmentsError.message}`,
      };
    }
    if ((assignments ?? []).length > 0) {
      return {
        ok: false,
        reason: "Trainer still has at least one batch assignment; skipped.",
      };
    }

    const { error: deleteTrainerError } = await safely(() =>
      supabase.from("trainers").delete().eq("id", identity.trainerId),
    );
    if (deleteTrainerError) {
      return {
        ok: false,
        reason: `Could not delete trainer: ${deleteTrainerError.message}`,
      };
    }
  }

  const { error: authError } = await safely<unknown>(() =>
    supabase.auth.admin.deleteUser(identity.authUserId),
  );
  if (authError) {
    return { ok: false, reason: `Could not delete auth user: ${authError.message}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Student Portal identity — a real login: auth.users + user_roles('student')
// + a students row, duplicated from e2e/support/phase12-fixtures.ts's own
// shape.

export type Phase13StudentPortalIdentity = {
  authUserId: string;
  email: string;
  password: string;
  studentId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase13PartialStudentPortalIdentityError extends Error {
  partial: Phase13StudentPortalIdentity;
  constructor(message: string, partial: Phase13StudentPortalIdentity) {
    super(message);
    this.name = "Phase13PartialStudentPortalIdentityError";
    this.partial = partial;
  }
}

export async function createPhase13StudentPortalIdentity(
  tag: string,
): Promise<Phase13StudentPortalIdentity> {
  const supabase = adminClient();
  const firstName = `${PHASE13_E2E_PREFIX}${tag}`;
  const lastName = "Student";
  const email = `phase13-e2e-student-${tag.toLowerCase()}-${RUN_ID}@${PHASE13_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();
  // 9700-9799 block — distinct from every other phase's own literal/random
  // phone block (Phase 5: 9100s, Phase 9: 9200s, Phase 10: 9300s, Phase 11:
  // 9400s/9500s, Phase 12: 9600s).
  const phone = `97${randomInt(0, 10)}${randomInt(0, 10)}${randomInt(100, 1000)}${randomInt(100, 1000)}`;

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(
      `Failed to create student portal identity (${tag}): ${error?.message}`,
    );
  }
  const authUserId = data.user.id;

  let partial: Phase13StudentPortalIdentity = {
    authUserId,
    email,
    password,
    studentId: null,
    firstName,
    lastName,
  };

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: authUserId, role: "student" }),
  );
  if (roleError) {
    throw new Phase13PartialStudentPortalIdentityError(
      `Failed to assign student role (auth user WAS already created): ${roleError.message}`,
      partial,
    );
  }

  const { data: studentRow, error: studentError } = await safely<{ id: string }>(() =>
    supabase
      .from("students")
      .insert({
        auth_user_id: authUserId,
        first_name: firstName,
        last_name: lastName,
        phone,
        email,
      })
      .select("id")
      .single(),
  );
  if (studentError || !studentRow) {
    throw new Phase13PartialStudentPortalIdentityError(
      `Failed to create students row (auth user + user_roles WERE already created): ${studentError?.message}`,
      partial,
    );
  }
  partial = { ...partial, studentId: studentRow.id };

  return partial;
}

export async function deletePhase13StudentPortalIdentity(
  identity: Phase13StudentPortalIdentity,
): Promise<Phase13DeleteResult> {
  const supabase = adminClient();

  if (identity.studentId) {
    const { data: enrollments, error: enrollmentsError } = await safely(() =>
      supabase
        .from("enrollments")
        .select("id")
        .eq("student_id", identity.studentId)
        .limit(1),
    );
    if (enrollmentsError) {
      return {
        ok: false,
        reason: `Could not check enrollment dependents: ${enrollmentsError.message}`,
      };
    }
    if ((enrollments ?? []).length > 0) {
      return { ok: false, reason: "Student still has at least one enrollment; skipped." };
    }

    const { error: deleteStudentError } = await safely(() =>
      supabase.from("students").delete().eq("id", identity.studentId),
    );
    if (deleteStudentError) {
      return {
        ok: false,
        reason: `Could not delete student: ${deleteStudentError.message}`,
      };
    }
  }

  const { error: authError } = await safely<unknown>(() =>
    supabase.auth.admin.deleteUser(identity.authUserId),
  );
  if (authError) {
    return { ok: false, reason: `Could not delete auth user: ${authError.message}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Read-only lookup — no synthetic Program/Batch rows are ever created for
// this suite, same reasoning as e2e/support/phase12-fixtures.ts's own
// findTwoExistingProgramsWithBatches (duplicated here, not imported, per
// this file's own header comment).

export type ExistingProgramWithBatch = {
  programId: string;
  programName: string;
  batchId: string;
  batchName: string;
};

export async function findTwoExistingProgramsWithBatches(): Promise<
  [ExistingProgramWithBatch, ExistingProgramWithBatch] | null
> {
  const supabase = adminClient();
  const { data: batches, error: batchesError } = await supabase
    .from("batches")
    .select("id, name, program_id")
    .order("id", { ascending: true })
    .limit(2);
  if (batchesError) {
    throw new Error(`Could not look up existing batches: ${batchesError.message}`);
  }
  const rows = (batches ?? []) as Array<{ id: string; name: string; program_id: string }>;
  if (rows.length < 2) return null;

  const programIds = Array.from(new Set(rows.map((r) => r.program_id)));
  const { data: programs, error: programsError } = await supabase
    .from("programs")
    .select("id, name")
    .in("id", programIds);
  if (programsError) {
    throw new Error(`Could not look up batches' programs: ${programsError.message}`);
  }
  const programNameById = new Map(
    ((programs ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );

  const toPair = (row: { id: string; name: string; program_id: string }) => ({
    programId: row.program_id,
    programName: programNameById.get(row.program_id) ?? "",
    batchId: row.id,
    batchName: row.name,
  });

  return [toPair(rows[0]), toPair(rows[1])];
}

// ---------------------------------------------------------------------------
// Batch assignment — same reasoning/safety as
// e2e/support/phase12-fixtures.ts's assignPhase12TrainerToBatch: always
// is_primary: false, so this never collides with a real batch's already-
// assigned primary trainer.

export async function assignPhase13TrainerToBatch(
  trainerId: string,
  batchId: string,
): Promise<string> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("batch_trainers")
    .insert({ trainer_id: trainerId, batch_id: batchId, is_primary: false })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to assign synthetic trainer to batch: ${error?.message}`);
  }
  return data.id;
}

export async function deletePhase13BatchAssignmentIfSafe(
  batchTrainerId: string,
): Promise<Phase13DeleteResult> {
  const supabase = adminClient();
  const { error } = await safely(() =>
    supabase.from("batch_trainers").delete().eq("id", batchTrainerId),
  );
  if (error) {
    return { ok: false, reason: `Could not remove batch assignment: ${error.message}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Enrollment — ties a real Student Portal identity to a real (program,
// batch) pair, same shape as e2e/support/phase12-fixtures.ts's own
// createPhase12SyntheticEnrollment, so attendance_select_own/attendance
// eligibility has something real to scope against for that student.

export async function createPhase13SyntheticEnrollment(input: {
  studentId: string;
  programId: string;
  batchId: string;
  agreedFeeRupees: number;
}): Promise<string> {
  const supabase = adminClient();
  const fee = `${input.agreedFeeRupees}.00`;
  const { data, error } = await supabase
    .from("enrollments")
    .insert({
      student_id: input.studentId,
      program_id: input.programId,
      batch_id: input.batchId,
      regular_fee: fee,
      agreed_fee: fee,
      total_payable: fee,
      status: "enrolled",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create synthetic enrollment: ${error?.message}`);
  }
  return data.id;
}

const ENROLLMENT_DEPENDENT_TABLES = [
  "payment_plans",
  "payments",
  "attendance",
  "assignment_submissions",
  "certificates",
] as const;

export async function deletePhase13SyntheticEnrollmentIfSafe(
  enrollmentId: string,
): Promise<Phase13DeleteResult> {
  const supabase = adminClient();

  for (const table of ENROLLMENT_DEPENDENT_TABLES) {
    const { data, error } = await safely(() =>
      supabase.from(table).select("id").eq("enrollment_id", enrollmentId).limit(1),
    );
    if (error) {
      return {
        ok: false,
        reason: `Could not check ${table} dependents: ${error.message}`,
      };
    }
    if ((data ?? []).length > 0) {
      return { ok: false, reason: `Enrollment still has a ${table} row; skipped.` };
    }
  }

  const { error: deleteError } = await safely(() =>
    supabase.from("enrollments").delete().eq("id", enrollmentId),
  );
  if (deleteError) {
    return { ok: false, reason: `Could not delete enrollment: ${deleteError.message}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Class sessions — the Admin/Trainer describe blocks reach their Attendance
// route via a real, directly-created session (creation itself is already
// proven by Phase 12's own D/G tests, not re-tested here — see this file's
// own header comment and the Phase 13 report's Requirement→Test mapping for
// why marking/correcting attendance, not session creation, is what's under
// test). Every describe block owns its own session row(s); none depend on
// another describe block's — the Phase 13 acceptance protocol runs tests ONE
// AT A TIME via `-g`, under which a sibling describe block's beforeAll never
// runs at all.

export async function createPhase13ClassSessionDirect(input: {
  batchId: string;
  sessionDate: string;
  status?: "scheduled" | "completed" | "cancelled" | "rescheduled";
  topic?: string;
}): Promise<string> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("class_sessions")
    .insert({
      batch_id: input.batchId,
      session_date: input.sessionDate,
      status: input.status ?? "scheduled",
      topic: input.topic ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create class session fixture: ${error?.message}`);
  }
  return data.id;
}

const CLASS_SESSION_DEPENDENT_TABLES = ["attendance", "materials"] as const;

export async function deletePhase13ClassSessionIfSafe(
  sessionId: string,
): Promise<Phase13DeleteResult> {
  const supabase = adminClient();

  for (const table of CLASS_SESSION_DEPENDENT_TABLES) {
    const { data, error } = await safely(() =>
      supabase.from(table).select("id").eq("class_session_id", sessionId).limit(1),
    );
    if (error) {
      return {
        ok: false,
        reason: `Could not check ${table} dependents: ${error.message}`,
      };
    }
    if ((data ?? []).length > 0) {
      return { ok: false, reason: `Class session still has a ${table} row; skipped.` };
    }
  }

  const { error: deleteError } = await safely(() =>
    supabase.from("class_sessions").delete().eq("id", sessionId),
  );
  if (deleteError) {
    return {
      ok: false,
      reason: `Could not delete class session: ${deleteError.message}`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Attendance — a direct service-role insert for tests whose purpose is NOT
// proving creation itself (already covered by this suite's own "mark
// attendance" UI-driven tests), only for pre-existing-state scenarios: the
// Student describe block's own visibility check needs a real, already-marked
// row to read, not to create one through the UI.

export async function createPhase13AttendanceDirect(input: {
  classSessionId: string;
  enrollmentId: string;
  studentId: string;
  batchId: string;
  status: "present" | "absent" | "late" | "excused";
  markedBy: string;
  markedByType: "trainer" | "admin";
}): Promise<string> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("attendance")
    .insert({
      class_session_id: input.classSessionId,
      enrollment_id: input.enrollmentId,
      student_id: input.studentId,
      batch_id: input.batchId,
      status: input.status,
      marked_by: input.markedBy,
      marked_by_type: input.markedByType,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create attendance fixture: ${error?.message}`);
  }
  return data.id;
}

// Checks attendance_audit before deleting — `on delete cascade` would
// otherwise silently remove any audit history too, the same "check first,
// never force" convention as deletePhase13ClassSessionIfSafe above.
const ATTENDANCE_DEPENDENT_TABLES = ["attendance_audit"] as const;

export async function deletePhase13AttendanceIfSafe(
  attendanceId: string,
): Promise<Phase13DeleteResult> {
  const supabase = adminClient();

  for (const table of ATTENDANCE_DEPENDENT_TABLES) {
    const { data, error } = await safely(() =>
      supabase.from(table).select("id").eq("attendance_id", attendanceId).limit(1),
    );
    if (error) {
      return {
        ok: false,
        reason: `Could not check ${table} dependents: ${error.message}`,
      };
    }
    if ((data ?? []).length > 0) {
      return { ok: false, reason: `Attendance row still has a ${table} row; skipped.` };
    }
  }

  const { error: deleteError } = await safely(() =>
    supabase.from("attendance").delete().eq("id", attendanceId),
  );
  if (deleteError) {
    return {
      ok: false,
      reason: `Could not delete attendance row: ${deleteError.message}`,
    };
  }
  return { ok: true };
}
