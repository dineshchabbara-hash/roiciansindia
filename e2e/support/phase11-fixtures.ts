import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

/**
 * Node-side setup/teardown for the Phase 11 (Trainer Portal) live-data E2E
 * suite (e2e/phase11-trainer-portal.spec.ts). A deliberately separate,
 * self-contained implementation from e2e/support/phase10-fixtures.ts, same
 * reasoning as that file's own header comment for why IT doesn't reuse
 * Phase 9's. Only the environment check (hasRealSupabaseCredentials) is
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

export const PHASE11_E2E_EMAIL_DOMAIN = "phase11-e2e.internal.test";
export const PHASE11_E2E_PREFIX = "Phase11E2E";

const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export type Phase11DeleteResult = { ok: boolean; reason?: string };

// ---------------------------------------------------------------------------
// Login identities for the "wrong role denied from /trainer" checks
// (Admin, Student) — full auth.users + user_roles, plus a profile row where
// the role needs one for its own portal home to resolve. Mirrors
// e2e/support/phase10-fixtures.ts's createPhase10LoginIdentity exactly for
// this part, duplicated per this file's own header comment.

export type Phase11RoleKind = "admin" | "super_admin" | "student";

export type Phase11LoginIdentity = {
  authUserId: string;
  email: string;
  password: string;
  role: Phase11RoleKind;
  hasProfile: boolean;
};

export class Phase11PartialLoginIdentityError extends Error {
  partial: Phase11LoginIdentity;
  constructor(message: string, partial: Phase11LoginIdentity) {
    super(message);
    this.name = "Phase11PartialLoginIdentityError";
    this.partial = partial;
  }
}

export async function createPhase11LoginIdentity(
  role: Phase11RoleKind,
  tag: string,
): Promise<Phase11LoginIdentity> {
  const supabase = adminClient();
  const email = `phase11-e2e-${role}-${tag}-${RUN_ID}@${PHASE11_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(`Failed to create ${role} login identity: ${error?.message}`);
  }
  const authUserId = data.user.id;

  let partial: Phase11LoginIdentity = {
    authUserId,
    email,
    password,
    role,
    hasProfile: false,
  };

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: authUserId, role }),
  );
  if (roleError) {
    throw new Phase11PartialLoginIdentityError(
      `Failed to assign role ${role} to login identity (auth user WAS already created): ${roleError.message}`,
      partial,
    );
  }

  if (role === "admin" || role === "super_admin") {
    const { error: profileError } = await safely(() =>
      supabase.from("admins").insert({
        auth_user_id: authUserId,
        first_name: PHASE11_E2E_PREFIX,
        last_name: role === "super_admin" ? "SuperAdmin" : "Admin",
        email,
        role_level: role,
      }),
    );
    if (profileError) {
      throw new Phase11PartialLoginIdentityError(
        `Failed to create admin profile (auth user + user_roles WERE already created): ${profileError.message}`,
        partial,
      );
    }
    partial = { ...partial, hasProfile: true };
  }
  // Student role deliberately gets no `students` row here — this identity
  // is only ever used for the authorization-blocked check (a Student role
  // reaching /trainer), never as an enrollment subject.

  return partial;
}

export async function deletePhase11LoginIdentity(
  identity: Phase11LoginIdentity,
): Promise<Phase11DeleteResult> {
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
// Student Portal identity — a real login: auth.users + user_roles('student')
// + a students row, same shape as e2e/support/phase10-fixtures.ts's own
// Phase10StudentPortalIdentity, duplicated here per this file's own header
// comment rather than imported across phases. Used for the Phase 10
// regression spot-check (Student login/dashboard still work unaffected by
// Phase 11's additive navigation.ts change) — a bare role-only identity
// (Phase11LoginIdentity above) is enough to prove role-based denial from
// /trainer, but not enough to prove the Student Portal itself still works.

export type Phase11StudentPortalIdentity = {
  authUserId: string;
  email: string;
  password: string;
  studentId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase11PartialStudentPortalIdentityError extends Error {
  partial: Phase11StudentPortalIdentity;
  constructor(message: string, partial: Phase11StudentPortalIdentity) {
    super(message);
    this.name = "Phase11PartialStudentPortalIdentityError";
    this.partial = partial;
  }
}

export async function createPhase11StudentPortalIdentity(
  tag: string,
): Promise<Phase11StudentPortalIdentity> {
  const supabase = adminClient();
  const firstName = `${PHASE11_E2E_PREFIX}${tag}`;
  const lastName = "Student";
  const email = `phase11-e2e-student-${tag.toLowerCase()}-${RUN_ID}@${PHASE11_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();
  // 9500-9599 block — distinct from Phase 5 (9100s), Phase 9 (9200s), Phase
  // 10 (9300s), and this file's own synthetic-enrollment-subject students
  // (9400s, createPhase11SyntheticStudent above).
  const phone = `95${randomInt(0, 10)}${randomInt(0, 10)}${randomInt(100, 1000)}${randomInt(100, 1000)}`;

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(
      `Failed to create student portal identity (${tag}): ${error?.message}`,
    );
  }
  const authUserId = data.user.id;

  let partial: Phase11StudentPortalIdentity = {
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
    throw new Phase11PartialStudentPortalIdentityError(
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
    throw new Phase11PartialStudentPortalIdentityError(
      `Failed to create students row (auth user + user_roles WERE already created): ${studentError?.message}`,
      partial,
    );
  }
  partial = { ...partial, studentId: studentRow.id };

  return partial;
}

export async function deletePhase11StudentPortalIdentity(
  identity: Phase11StudentPortalIdentity,
): Promise<Phase11DeleteResult> {
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
// Trainer Portal identity — a real login: auth.users + user_roles('trainer')
// + a trainers row whose OWN auth_user_id points back to that same auth
// user, so current_trainer_id() (supabase/migrations/20260101000014_rls_
// policies.sql) resolves correctly and a real /login/trainer session can be
// exercised. Same shape as e2e/support/phase10-fixtures.ts's
// Phase10StudentPortalIdentity.

export type Phase11TrainerPortalIdentity = {
  authUserId: string;
  email: string;
  password: string;
  trainerId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase11PartialTrainerPortalIdentityError extends Error {
  partial: Phase11TrainerPortalIdentity;
  constructor(message: string, partial: Phase11TrainerPortalIdentity) {
    super(message);
    this.name = "Phase11PartialTrainerPortalIdentityError";
    this.partial = partial;
  }
}

export async function createPhase11TrainerPortalIdentity(
  tag: string,
): Promise<Phase11TrainerPortalIdentity> {
  const supabase = adminClient();
  const firstName = `${PHASE11_E2E_PREFIX}${tag}`;
  const lastName = "Trainer";
  const email = `phase11-e2e-trainer-${tag.toLowerCase()}-${RUN_ID}@${PHASE11_E2E_EMAIL_DOMAIN}`;
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

  let partial: Phase11TrainerPortalIdentity = {
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
    throw new Phase11PartialTrainerPortalIdentityError(
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
    throw new Phase11PartialTrainerPortalIdentityError(
      `Failed to create trainers row (auth user + user_roles WERE already created): ${trainerError?.message}`,
      partial,
    );
  }
  partial = { ...partial, trainerId: trainerRow.id };

  return partial;
}

/**
 * Deletes one known Trainer Portal identity, but only after verifying its
 * `trainers` row is safe to remove — same "check every dependent table,
 * never assume" discipline as
 * e2e/support/phase10-fixtures.ts's deletePhase10StudentPortalIdentity. The
 * caller is responsible for unassigning any batch_trainers row created for
 * this trainer FIRST (deletePhase11BatchAssignment below) — this function
 * refuses to proceed while one still exists (batch_trainers.trainer_id is
 * `on delete restrict`).
 */
export async function deletePhase11TrainerPortalIdentity(
  identity: Phase11TrainerPortalIdentity,
): Promise<Phase11DeleteResult> {
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
// Read-only lookup — no synthetic Program/Batch rows are ever created for
// this suite, same reasoning as e2e/support/phase9-fixtures.ts's
// findExistingProgramWithBatch. Two DISTINCT pairs are needed here (unlike
// Phase 9/10) so Trainer A and Trainer B can each be assigned to a
// different real batch, to prove cross-trainer isolation.

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
// Batch assignment — assigns an existing real batch to a synthetic Trainer,
// deliberately never as the primary trainer (is_primary: false), so this
// never collides with a real batch's already-assigned primary trainer
// (20260101000020_batch_trainers_one_primary_per_batch.sql). Only this one
// added row is ever touched by cleanup — the real batch's own pre-existing
// trainer assignments are never read, modified, or removed.

export async function assignPhase11TrainerToBatch(
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

export async function deletePhase11BatchAssignmentIfSafe(
  batchTrainerId: string,
): Promise<Phase11DeleteResult> {
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
// Synthetic students + enrollments — a plain `students` row with no auth
// account (mirrors e2e/support/phase9-fixtures.ts's
// createPhase9SyntheticStudent: only ever an Enrollment subject, never
// logged into) plus a real Enrollment tying that student to the given real
// (program, batch) pair — this is what makes the student appear in
// trainer_visible_students()/trainer_visible_enrollments() for whichever
// Trainer is assigned to that batch.

export type Phase11SyntheticStudent = { id: string; firstName: string; lastName: string };

export async function createPhase11SyntheticStudent(
  tag: string,
): Promise<Phase11SyntheticStudent> {
  const supabase = adminClient();
  const firstName = `${PHASE11_E2E_PREFIX}${tag}`;
  const lastName = "Student";
  // 9400-9499 block — distinct from Phase 5 (9100s), Phase 9 (9200s), and
  // Phase 10 (9300s) literals, plus a random tail so concurrent scenarios
  // within one run don't collide.
  const phone = `94${randomInt(0, 10)}${randomInt(0, 10)}${randomInt(100, 1000)}${randomInt(100, 1000)}`;
  const email = `phase11-e2e-${tag.toLowerCase()}-${RUN_ID}@${PHASE11_E2E_EMAIL_DOMAIN}`;

  const { data, error } = await supabase
    .from("students")
    .insert({ first_name: firstName, last_name: lastName, phone, email })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create synthetic student (${tag}): ${error?.message}`);
  }
  return { id: data.id, firstName, lastName };
}

export async function createPhase11SyntheticEnrollment(input: {
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

// Same dependent-table list and "check, never assume" discipline as
// e2e/support/phase9-fixtures.ts's deletePhase9SyntheticEnrollmentIfSafe,
// duplicated per this file's own header comment.
const ENROLLMENT_DEPENDENT_TABLES = [
  "payment_plans",
  "payments",
  "attendance",
  "assignment_submissions",
  "certificates",
] as const;

export async function deletePhase11SyntheticEnrollmentIfSafe(
  enrollmentId: string,
): Promise<Phase11DeleteResult> {
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

export async function deletePhase11SyntheticStudentIfSafe(
  studentId: string,
): Promise<Phase11DeleteResult> {
  const supabase = adminClient();

  const { data: enrollments, error: enrollmentsError } = await safely(() =>
    supabase.from("enrollments").select("id").eq("student_id", studentId).limit(1),
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

  const { data: notes, error: notesError } = await safely(() =>
    supabase.from("student_notes").select("id").eq("student_id", studentId).limit(1),
  );
  if (notesError) {
    return {
      ok: false,
      reason: `Could not check note dependents: ${notesError.message}`,
    };
  }
  if ((notes ?? []).length > 0) {
    return { ok: false, reason: "Student still has at least one note; skipped." };
  }

  const { data: documents, error: documentsError } = await safely(() =>
    supabase.from("student_documents").select("id").eq("student_id", studentId).limit(1),
  );
  if (documentsError) {
    return {
      ok: false,
      reason: `Could not check document dependents: ${documentsError.message}`,
    };
  }
  if ((documents ?? []).length > 0) {
    return { ok: false, reason: "Student still has at least one document; skipped." };
  }

  const { error: deleteError } = await safely(() =>
    supabase.from("students").delete().eq("id", studentId),
  );
  if (deleteError) {
    return { ok: false, reason: `Could not delete student: ${deleteError.message}` };
  }
  return { ok: true };
}
