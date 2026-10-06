import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

/**
 * Node-side setup/teardown for the Phase 15 (Learning Materials) live-data
 * E2E suite (e2e/phase15-materials.spec.ts). A deliberately separate,
 * self-contained implementation from e2e/support/phase14-fixtures.ts, same
 * reasoning as every prior phase's own fixtures file header comment for why
 * it doesn't reuse the previous phase's — each phase's fixtures/markers
 * must be independently auditable. Only the environment check
 * (hasRealSupabaseCredentials) is re-exported, since it has no
 * phase-specific behavior at all.
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

// Same double-failure-mode normalization as every prior phase's own
// safely() — see e.g. e2e/support/phase14-fixtures.ts's own doc comment.
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

export const PHASE15_E2E_EMAIL_DOMAIN = "phase15-e2e.internal.test";
export const PHASE15_E2E_PREFIX = "Phase15E2E";

export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export type Phase15DeleteResult = { ok: boolean; reason?: string };

// A small, deterministic, non-sensitive synthetic PDF fixture — a real
// %PDF-4-byte signature (matchesMaterialFileSignature in
// lib/domain/materials.ts checks exactly this), plus the Phase 15 marker
// text, so a successfully-uploaded object is unambiguously traceable to
// this suite's own run even by content, not just by its server-generated
// path. Never committed anywhere — built in memory per test run.
export function buildPhase15FixturePdf(): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${PHASE15_E2E_PREFIX} ${RUN_ID} synthetic fixture file.\n%%EOF\n`,
  );
}

// ---------------------------------------------------------------------------
// Admin login identity — full auth.users + user_roles('admin') + an admins
// row, same shape as every prior phase's own admin identity.

export type Phase15AdminIdentity = {
  authUserId: string;
  email: string;
  password: string;
  hasProfile: boolean;
};

export class Phase15PartialAdminIdentityError extends Error {
  partial: Phase15AdminIdentity;
  constructor(message: string, partial: Phase15AdminIdentity) {
    super(message);
    this.name = "Phase15PartialAdminIdentityError";
    this.partial = partial;
  }
}

export async function createPhase15AdminIdentity(
  tag: string,
): Promise<Phase15AdminIdentity> {
  const supabase = adminClient();
  const email = `phase15-e2e-admin-${tag.toLowerCase()}-${RUN_ID}@${PHASE15_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(`Failed to create admin identity (${tag}): ${error?.message}`);
  }
  const authUserId = data.user.id;

  let partial: Phase15AdminIdentity = { authUserId, email, password, hasProfile: false };

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: authUserId, role: "admin" }),
  );
  if (roleError) {
    throw new Phase15PartialAdminIdentityError(
      `Failed to assign admin role (auth user WAS already created): ${roleError.message}`,
      partial,
    );
  }

  const { error: profileError } = await safely(() =>
    supabase.from("admins").insert({
      auth_user_id: authUserId,
      first_name: PHASE15_E2E_PREFIX,
      last_name: "Admin",
      email,
      role_level: "admin",
    }),
  );
  if (profileError) {
    throw new Phase15PartialAdminIdentityError(
      `Failed to create admin profile (auth user + user_roles WERE already created): ${profileError.message}`,
      partial,
    );
  }
  partial = { ...partial, hasProfile: true };

  return partial;
}

export async function deletePhase15AdminIdentity(
  identity: Phase15AdminIdentity,
): Promise<Phase15DeleteResult> {
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
// + a trainers row, duplicated from e2e/support/phase13-fixtures.ts's own
// shape.

export type Phase15TrainerPortalIdentity = {
  authUserId: string;
  email: string;
  password: string;
  trainerId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase15PartialTrainerPortalIdentityError extends Error {
  partial: Phase15TrainerPortalIdentity;
  constructor(message: string, partial: Phase15TrainerPortalIdentity) {
    super(message);
    this.name = "Phase15PartialTrainerPortalIdentityError";
    this.partial = partial;
  }
}

export async function createPhase15TrainerPortalIdentity(
  tag: string,
): Promise<Phase15TrainerPortalIdentity> {
  const supabase = adminClient();
  const firstName = `${PHASE15_E2E_PREFIX}${tag}`;
  const lastName = "Trainer";
  const email = `phase15-e2e-trainer-${tag.toLowerCase()}-${RUN_ID}@${PHASE15_E2E_EMAIL_DOMAIN}`;
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

  let partial: Phase15TrainerPortalIdentity = {
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
    throw new Phase15PartialTrainerPortalIdentityError(
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
    throw new Phase15PartialTrainerPortalIdentityError(
      `Failed to create trainers row (auth user + user_roles WERE already created): ${trainerError?.message}`,
      partial,
    );
  }
  partial = { ...partial, trainerId: trainerRow.id };

  return partial;
}

export async function deletePhase15TrainerPortalIdentity(
  identity: Phase15TrainerPortalIdentity,
): Promise<Phase15DeleteResult> {
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
// + a students row, duplicated from e2e/support/phase14-fixtures.ts's own
// shape.

export type Phase15StudentPortalIdentity = {
  authUserId: string;
  email: string;
  password: string;
  studentId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase15PartialStudentPortalIdentityError extends Error {
  partial: Phase15StudentPortalIdentity;
  constructor(message: string, partial: Phase15StudentPortalIdentity) {
    super(message);
    this.name = "Phase15PartialStudentPortalIdentityError";
    this.partial = partial;
  }
}

export async function createPhase15StudentPortalIdentity(
  tag: string,
): Promise<Phase15StudentPortalIdentity> {
  const supabase = adminClient();
  const firstName = `${PHASE15_E2E_PREFIX}${tag}`;
  const lastName = "Student";
  const email = `phase15-e2e-student-${tag.toLowerCase()}-${RUN_ID}@${PHASE15_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();
  // 9900-9999 block — distinct from every other phase's own literal/random
  // phone block (Phase 5: 9100s, Phase 9: 9200s, Phase 10: 9300s, Phase 11:
  // 9400s/9500s, Phase 12: 9600s, Phase 13: 9700s, Phase 14: 9800s).
  const phone = `99${randomInt(0, 10)}${randomInt(0, 10)}${randomInt(100, 1000)}${randomInt(100, 1000)}`;

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(
      `Failed to create student portal identity (${tag}): ${error?.message}`,
    );
  }
  const authUserId = data.user.id;

  let partial: Phase15StudentPortalIdentity = {
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
    throw new Phase15PartialStudentPortalIdentityError(
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
    throw new Phase15PartialStudentPortalIdentityError(
      `Failed to create students row (auth user + user_roles WERE already created): ${studentError?.message}`,
      partial,
    );
  }
  partial = { ...partial, studentId: studentRow.id };

  return partial;
}

export async function deletePhase15StudentPortalIdentity(
  identity: Phase15StudentPortalIdentity,
): Promise<Phase15DeleteResult> {
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
// this suite, same reasoning as every prior phase's own
// findExistingProgramWithBatch (duplicated here, not imported, per this
// file's own header comment). No installments_allowed filter is needed
// here — Materials has no relationship to that flag at all.

export type ExistingProgramWithBatch = {
  programId: string;
  programName: string;
  batchId: string;
  batchName: string;
};

export async function findExistingProgramWithBatch(): Promise<ExistingProgramWithBatch | null> {
  const supabase = adminClient();
  const { data: batches, error: batchesError } = await supabase
    .from("batches")
    .select("id, name, program_id, program:programs!inner(name)")
    .order("id", { ascending: true })
    .limit(1);
  if (batchesError) {
    throw new Error(`Could not look up an existing batch: ${batchesError.message}`);
  }
  const rows = (batches ?? []) as unknown as Array<{
    id: string;
    name: string;
    program_id: string;
    program: { name: string } | null;
  }>;
  if (rows.length < 1) return null;

  return {
    programId: rows[0].program_id,
    programName: rows[0].program?.name ?? "",
    batchId: rows[0].id,
    batchName: rows[0].name,
  };
}

// ---------------------------------------------------------------------------
// Batch assignment — same reasoning/safety as every prior phase's own
// assignTrainerToBatch: always is_primary: false, so this never collides
// with a real batch's already-assigned primary trainer.

export async function assignPhase15TrainerToBatch(
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

export async function deletePhase15BatchAssignmentIfSafe(
  batchTrainerId: string,
): Promise<Phase15DeleteResult> {
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
// batch) pair, same shape as every prior phase's own
// createPhaseNSyntheticEnrollment, so materials_select_student has
// something real to scope against for that student. Always 'enrolled' —
// the enrollment-status edge cases (completed/withdrawn/lead) are proven at
// the RLS layer by supabase/tests/phase15_materials_test.sql, not
// re-exercised through the browser (see this phase's own E2E spec header
// comment for the requirement→test mapping).

export async function createPhase15SyntheticEnrollment(input: {
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

export async function deletePhase15SyntheticEnrollmentIfSafe(
  enrollmentId: string,
): Promise<Phase15DeleteResult> {
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
// Class session — the Trainer Session-scoped Materials test reaches its
// route via a real, directly-created session (creation itself is already
// proven by Phase 12's own E2E suite, not re-tested here — same precedent
// as e2e/support/phase13-fixtures.ts's own createPhase13ClassSessionDirect).

export async function createPhase15ClassSessionDirect(input: {
  batchId: string;
  sessionDate: string;
  topic?: string;
}): Promise<string> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("class_sessions")
    .insert({
      batch_id: input.batchId,
      session_date: input.sessionDate,
      status: "scheduled",
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

export async function deletePhase15ClassSessionIfSafe(
  sessionId: string,
): Promise<Phase15DeleteResult> {
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
// Module — a new program_modules row attached to a real Program (never a
// mutation of the Program/Batch/Session row itself, same category of
// attachment as createPhase15SyntheticEnrollment above), needed because the
// Module-scoped Admin creation test (which also proves this phase's own
// getProgramMaterialsIncludingModules fix) requires a real Module to pick —
// most dev-project Programs have none yet, so a direct lookup would be
// unreliable. A high `sequence` value avoids colliding with program_
// modules_unique_sequence against any of that Program's real Modules.

export async function createPhase15SyntheticModule(
  programId: string,
  title: string,
): Promise<string> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("program_modules")
    .insert({ program_id: programId, title, sequence: 9000 + randomInt(0, 999) })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create synthetic module: ${error?.message}`);
  }
  return data.id;
}

export async function deletePhase15SyntheticModuleIfSafe(
  moduleId: string,
): Promise<Phase15DeleteResult> {
  const supabase = adminClient();

  const { data: materials, error: materialsError } = await safely(() =>
    supabase.from("materials").select("id").eq("module_id", moduleId).limit(1),
  );
  if (materialsError) {
    return {
      ok: false,
      reason: `Could not check materials dependents: ${materialsError.message}`,
    };
  }
  if ((materials ?? []).length > 0) {
    return { ok: false, reason: "Module still has at least one material; skipped." };
  }

  const { error: deleteError } = await safely(() =>
    supabase.from("program_modules").delete().eq("id", moduleId),
  );
  if (deleteError) {
    return { ok: false, reason: `Could not delete module: ${deleteError.message}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Material — a direct service-role insert for tests whose purpose is NOT
// proving creation itself (already covered by this suite's own UI-driven
// Admin/Trainer creation tests): the Student visibility test needs a real,
// already-created material to read, not to create one through the UI.

export async function createPhase15MaterialDirect(input: {
  scopeColumn: "program_id" | "batch_id" | "module_id" | "class_session_id";
  scopeId: string;
  title: string;
  uploadedBy: string;
  uploadedByType: "admin" | "trainer";
}): Promise<string> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("materials")
    .insert({
      [input.scopeColumn]: input.scopeId,
      title: input.title,
      material_type: "link",
      external_url: "https://example.com/phase15-e2e-fixture",
      uploaded_by: input.uploadedBy,
      uploaded_by_type: input.uploadedByType,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create material fixture: ${error?.message}`);
  }
  return data.id;
}

// ---------------------------------------------------------------------------
// UI-driven material cleanup — the Admin/Trainer creation tests create a
// material through the actual running app (never through
// createPhase15MaterialDirect above), so no caller-side material id is ever
// returned to the test for it to track. Looks up the material by its own
// exact (scope column + id, title) pair — both already synthetic/unique to
// the calling test — rather than any broader filter. Deletes the backing
// Storage object first (by its own exact stored file_path — never a broader
// prefix/directory delete), then the metadata row. No-ops (ok: true) when
// no such material was ever created in this process (e.g. a sibling test
// in the same describe block was filtered out via `-g`).

export async function deletePhase15MaterialByTitleIfExists(
  scopeColumn: "program_id" | "batch_id" | "module_id" | "class_session_id",
  scopeId: string,
  title: string,
): Promise<Phase15DeleteResult> {
  const supabase = adminClient();

  const { data: material, error: lookupError } = await safely<{
    id: string;
    file_path: string | null;
  }>(() =>
    supabase
      .from("materials")
      .select("id, file_path")
      .eq(scopeColumn, scopeId)
      .eq("title", title)
      .maybeSingle(),
  );
  if (lookupError) {
    return {
      ok: false,
      reason: `Could not look up the material: ${lookupError.message}`,
    };
  }
  if (!material) return { ok: true };

  return deletePhase15MaterialIfExists(material.id, material.file_path);
}

export async function deletePhase15MaterialIfExists(
  materialId: string,
  filePath: string | null,
): Promise<Phase15DeleteResult> {
  const supabase = adminClient();

  if (filePath) {
    const { error: storageError } = await safely(() =>
      supabase.storage.from("materials").remove([filePath]),
    );
    if (storageError) {
      return {
        ok: false,
        reason: `Could not remove Storage object (${filePath}): ${storageError.message}`,
      };
    }
  }

  const { error: deleteError } = await safely(() =>
    supabase.from("materials").delete().eq("id", materialId),
  );
  if (deleteError) {
    return { ok: false, reason: `Could not delete material row: ${deleteError.message}` };
  }
  return { ok: true };
}
