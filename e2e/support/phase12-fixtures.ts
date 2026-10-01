import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

/**
 * Node-side setup/teardown for the Phase 12 (Class Sessions) live-data E2E
 * suite (e2e/phase12-class-sessions.spec.ts). A deliberately separate,
 * self-contained implementation from e2e/support/phase11-fixtures.ts, same
 * reasoning as that file's own header comment for why IT doesn't reuse
 * Phase 10's. Only the environment check (hasRealSupabaseCredentials) is
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

export const PHASE12_E2E_EMAIL_DOMAIN = "phase12-e2e.internal.test";
export const PHASE12_E2E_PREFIX = "Phase12E2E";

const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export type Phase12DeleteResult = { ok: boolean; reason?: string };

// ---------------------------------------------------------------------------
// Admin login identity — full auth.users + user_roles('admin') + an admins
// row, same shape as e2e/support/phase10-fixtures.ts's own admin identity.

export type Phase12AdminIdentity = {
  authUserId: string;
  email: string;
  password: string;
  hasProfile: boolean;
};

export class Phase12PartialAdminIdentityError extends Error {
  partial: Phase12AdminIdentity;
  constructor(message: string, partial: Phase12AdminIdentity) {
    super(message);
    this.name = "Phase12PartialAdminIdentityError";
    this.partial = partial;
  }
}

export async function createPhase12AdminIdentity(
  tag: string,
): Promise<Phase12AdminIdentity> {
  const supabase = adminClient();
  const email = `phase12-e2e-admin-${tag.toLowerCase()}-${RUN_ID}@${PHASE12_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(`Failed to create admin identity (${tag}): ${error?.message}`);
  }
  const authUserId = data.user.id;

  let partial: Phase12AdminIdentity = { authUserId, email, password, hasProfile: false };

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: authUserId, role: "admin" }),
  );
  if (roleError) {
    throw new Phase12PartialAdminIdentityError(
      `Failed to assign admin role (auth user WAS already created): ${roleError.message}`,
      partial,
    );
  }

  const { error: profileError } = await safely(() =>
    supabase.from("admins").insert({
      auth_user_id: authUserId,
      first_name: PHASE12_E2E_PREFIX,
      last_name: "Admin",
      email,
      role_level: "admin",
    }),
  );
  if (profileError) {
    throw new Phase12PartialAdminIdentityError(
      `Failed to create admin profile (auth user + user_roles WERE already created): ${profileError.message}`,
      partial,
    );
  }
  partial = { ...partial, hasProfile: true };

  return partial;
}

export async function deletePhase12AdminIdentity(
  identity: Phase12AdminIdentity,
): Promise<Phase12DeleteResult> {
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
// + a trainers row, same shape as e2e/support/phase11-fixtures.ts's own
// Phase11TrainerPortalIdentity, duplicated here per this file's own header
// comment rather than imported across phases.

export type Phase12TrainerPortalIdentity = {
  authUserId: string;
  email: string;
  password: string;
  trainerId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase12PartialTrainerPortalIdentityError extends Error {
  partial: Phase12TrainerPortalIdentity;
  constructor(message: string, partial: Phase12TrainerPortalIdentity) {
    super(message);
    this.name = "Phase12PartialTrainerPortalIdentityError";
    this.partial = partial;
  }
}

export async function createPhase12TrainerPortalIdentity(
  tag: string,
): Promise<Phase12TrainerPortalIdentity> {
  const supabase = adminClient();
  const firstName = `${PHASE12_E2E_PREFIX}${tag}`;
  const lastName = "Trainer";
  const email = `phase12-e2e-trainer-${tag.toLowerCase()}-${RUN_ID}@${PHASE12_E2E_EMAIL_DOMAIN}`;
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

  let partial: Phase12TrainerPortalIdentity = {
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
    throw new Phase12PartialTrainerPortalIdentityError(
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
    throw new Phase12PartialTrainerPortalIdentityError(
      `Failed to create trainers row (auth user + user_roles WERE already created): ${trainerError?.message}`,
      partial,
    );
  }
  partial = { ...partial, trainerId: trainerRow.id };

  return partial;
}

export async function deletePhase12TrainerPortalIdentity(
  identity: Phase12TrainerPortalIdentity,
): Promise<Phase12DeleteResult> {
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
// + a students row, same shape as e2e/support/phase11-fixtures.ts's own
// Phase11StudentPortalIdentity.

export type Phase12StudentPortalIdentity = {
  authUserId: string;
  email: string;
  password: string;
  studentId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase12PartialStudentPortalIdentityError extends Error {
  partial: Phase12StudentPortalIdentity;
  constructor(message: string, partial: Phase12StudentPortalIdentity) {
    super(message);
    this.name = "Phase12PartialStudentPortalIdentityError";
    this.partial = partial;
  }
}

export async function createPhase12StudentPortalIdentity(
  tag: string,
): Promise<Phase12StudentPortalIdentity> {
  const supabase = adminClient();
  const firstName = `${PHASE12_E2E_PREFIX}${tag}`;
  const lastName = "Student";
  const email = `phase12-e2e-student-${tag.toLowerCase()}-${RUN_ID}@${PHASE12_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();
  // 9600-9699 block — distinct from every other phase's own literal/random
  // phone block (Phase 5: 9100s, Phase 9: 9200s, Phase 10: 9300s, Phase 11:
  // 9400s/9500s).
  const phone = `96${randomInt(0, 10)}${randomInt(0, 10)}${randomInt(100, 1000)}${randomInt(100, 1000)}`;

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(
      `Failed to create student portal identity (${tag}): ${error?.message}`,
    );
  }
  const authUserId = data.user.id;

  let partial: Phase12StudentPortalIdentity = {
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
    throw new Phase12PartialStudentPortalIdentityError(
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
    throw new Phase12PartialStudentPortalIdentityError(
      `Failed to create students row (auth user + user_roles WERE already created): ${studentError?.message}`,
      partial,
    );
  }
  partial = { ...partial, studentId: studentRow.id };

  return partial;
}

export async function deletePhase12StudentPortalIdentity(
  identity: Phase12StudentPortalIdentity,
): Promise<Phase12DeleteResult> {
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
// this suite, same reasoning as e2e/support/phase11-fixtures.ts's
// findTwoExistingProgramsWithBatches. Two DISTINCT pairs are needed so
// Trainer A/Trainer B (and Student A, enrolled in one of them) can be scoped
// against two real, different batches, proving cross-batch isolation.

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
  // Ordered explicitly by id so repeated calls within one test run (Admin's
  // describe block, Trainer's, Student's) deterministically resolve to the
  // SAME two batches — a plain `limit(2)` with no order has no such
  // guarantee across separate queries.
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
// e2e/support/phase11-fixtures.ts's assignPhase11TrainerToBatch: always
// is_primary: false, so this never collides with a real batch's already-
// assigned primary trainer.

export async function assignPhase12TrainerToBatch(
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

export async function deletePhase12BatchAssignmentIfSafe(
  batchTrainerId: string,
): Promise<Phase12DeleteResult> {
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
// batch) pair, the same shape as every prior phase's own synthetic
// enrollment helper, so class_sessions_select_student has something real to
// scope against for that student.

export async function createPhase12SyntheticEnrollment(input: {
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

export async function deletePhase12SyntheticEnrollmentIfSafe(
  enrollmentId: string,
): Promise<Phase12DeleteResult> {
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

  const { error: auditError } = await safely(() =>
    supabase
      .from("audit_logs")
      .delete()
      .eq("entity_type", "enrollment")
      .eq("entity_id", enrollmentId),
  );
  if (auditError) {
    return {
      ok: false,
      reason: `Could not delete enrollment's own audit_logs rows: ${auditError.message}`,
    };
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
// Class sessions — the Admin/Trainer describe blocks create every session
// they test THROUGH the real application UI (proving the real create/edit
// flow end to end, per Phase 12 test items D/G). The Student describe block
// instead needs a real, pre-existing class_sessions row as a PRECONDITION
// (it is only proving read-scoping, not creation) — and, critically, it must
// not depend on the Trainer describe block's own UI-driven session having
// run first: the Phase 12 acceptance protocol runs tests ONE AT A TIME via
// `-g` (see the Phase 12 task brief's own "manual browser acceptance" gate),
// under which sibling describe blocks' tests never execute at all, only the
// describe block containing the matched test gets its own beforeAll/afterAll
// run. createPhase12ClassSessionDirect is a plain service-role insert for
// exactly this precondition-row need — the same "direct insert for setup,
// UI only for what's actually under test" split already used by
// createPhase12SyntheticEnrollment above.

export async function createPhase12ClassSessionDirect(input: {
  batchId: string;
  sessionDate: string;
  status?: "scheduled" | "completed" | "cancelled" | "rescheduled";
}): Promise<string> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("class_sessions")
    .insert({
      batch_id: input.batchId,
      session_date: input.sessionDate,
      status: input.status ?? "scheduled",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create class session fixture: ${error?.message}`);
  }
  return data.id;
}

// Cleanup-only helper — removes one class session by its own tracked id,
// never a bulk or date-range delete. Checks the same dependent tables
// (attendance/materials) that `on delete cascade` would otherwise silently
// remove, refusing instead, per this project's "check first, never force"
// convention (see e2e/support/phase9-fixtures.ts's own precedent).

const CLASS_SESSION_DEPENDENT_TABLES = ["attendance", "materials"] as const;

export async function deletePhase12ClassSessionIfSafe(
  sessionId: string,
): Promise<Phase12DeleteResult> {
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
