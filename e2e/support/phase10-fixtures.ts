import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

/**
 * Node-side setup/teardown for the Phase 10 (Student Portal) live-data E2E
 * suite (e2e/phase10-student-portal.spec.ts). A deliberately separate,
 * self-contained implementation from e2e/support/phase9-fixtures.ts, same
 * reasoning as that file's own header comment for why IT doesn't reuse
 * Phase 5's helpers: each phase's fixtures know their own exact, small set
 * of created ids and clean up only those, with no shared lifecycle across
 * phase fixture files. Only the environment check (hasRealSupabaseCredentials)
 * is re-exported, since it has no phase-specific behavior at all.
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

export const PHASE10_E2E_EMAIL_DOMAIN = "phase10-e2e.internal.test";
export const PHASE10_E2E_STUDENT_PREFIX = "Phase10E2E";

const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------------------
// Login identities for the "wrong role denied from /student" checks (Admin,
// Trainer) — full auth.users + user_roles, no students/trainers/admins
// profile row needed for the Trainer case since the redirect check never
// reaches a page that would query it; the Admin case does need a profile
// row (getCurrentUserContext resolves it) — mirrors
// e2e/support/phase9-fixtures.ts's createPhase9LoginIdentity exactly for
// this part, duplicated per this file's own header comment rather than
// imported.

export type Phase10RoleKind = "admin" | "trainer";

export type Phase10LoginIdentity = {
  authUserId: string;
  email: string;
  password: string;
  role: Phase10RoleKind;
  hasProfile: boolean;
};

export class Phase10PartialLoginIdentityError extends Error {
  partial: Phase10LoginIdentity;
  constructor(message: string, partial: Phase10LoginIdentity) {
    super(message);
    this.name = "Phase10PartialLoginIdentityError";
    this.partial = partial;
  }
}

export async function createPhase10LoginIdentity(
  role: Phase10RoleKind,
  tag: string,
): Promise<Phase10LoginIdentity> {
  const supabase = adminClient();
  const email = `phase10-e2e-${role}-${tag}-${RUN_ID}@${PHASE10_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(`Failed to create ${role} login identity: ${error?.message}`);
  }
  const authUserId = data.user.id;

  let partial: Phase10LoginIdentity = {
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
    throw new Phase10PartialLoginIdentityError(
      `Failed to assign role ${role} to login identity (auth user WAS already created): ${roleError.message}`,
      partial,
    );
  }

  const table = role === "admin" ? "admins" : "trainers";
  const { error: profileError } = await safely(() =>
    supabase.from(table).insert({
      auth_user_id: authUserId,
      first_name: PHASE10_E2E_STUDENT_PREFIX,
      last_name: role === "admin" ? "Admin" : "Trainer",
      email,
      ...(role === "admin" ? { role_level: "admin" } : {}),
    }),
  );
  if (profileError) {
    throw new Phase10PartialLoginIdentityError(
      `Failed to create ${role} profile (auth user + user_roles WERE already created): ${profileError.message}`,
      partial,
    );
  }
  partial = { ...partial, hasProfile: true };

  return partial;
}

export type Phase10DeleteResult = { ok: boolean; reason?: string };

export async function deletePhase10LoginIdentity(
  identity: Phase10LoginIdentity,
): Promise<Phase10DeleteResult> {
  const supabase = adminClient();

  if (identity.hasProfile) {
    const table = identity.role === "admin" ? "admins" : "trainers";
    const { error } = await safely(() =>
      supabase.from(table).delete().eq("auth_user_id", identity.authUserId),
    );
    if (error) {
      return {
        ok: false,
        reason: `Could not delete ${identity.role} profile: ${error.message}`,
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
// Student Portal identity — UNLIKE Phase 9's createPhase9SyntheticStudent
// (a students row with no auth account, only ever an Enrollment subject),
// this needs a REAL login: auth.users + user_roles('student') + a students
// row whose OWN auth_user_id points back to that same auth user, so
// current_student_id() (supabase/migrations/20260101000014_rls_policies.sql)
// resolves correctly and a real /login/student session can be exercised.

export type Phase10StudentPortalIdentity = {
  authUserId: string;
  email: string;
  password: string;
  studentId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase10PartialStudentPortalIdentityError extends Error {
  partial: Phase10StudentPortalIdentity;
  constructor(message: string, partial: Phase10StudentPortalIdentity) {
    super(message);
    this.name = "Phase10PartialStudentPortalIdentityError";
    this.partial = partial;
  }
}

export async function createPhase10StudentPortalIdentity(
  tag: string,
): Promise<Phase10StudentPortalIdentity> {
  const supabase = adminClient();
  const firstName = `${PHASE10_E2E_STUDENT_PREFIX}${tag}`;
  const lastName = "Student";
  const email = `phase10-e2e-student-${tag.toLowerCase()}-${RUN_ID}@${PHASE10_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();
  // 9300-9399 block — distinct from Phase 5's 9100-series and Phase 9's
  // 9200-series literals, plus a random tail so concurrent scenarios within
  // one run don't collide.
  const phone = `93${randomInt(0, 10)}${randomInt(0, 10)}${randomInt(100, 1000)}${randomInt(100, 1000)}`;

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(
      `Failed to create student portal identity (${tag}): ${error?.message}`,
    );
  }
  const authUserId = data.user.id;

  let partial: Phase10StudentPortalIdentity = {
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
    throw new Phase10PartialStudentPortalIdentityError(
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
    throw new Phase10PartialStudentPortalIdentityError(
      `Failed to create students row (auth user + user_roles WERE already created): ${studentError?.message}`,
      partial,
    );
  }
  partial = { ...partial, studentId: studentRow.id };

  return partial;
}

/**
 * Deletes one known Student Portal identity, but only after verifying its
 * `students` row is safe to remove — same "check every dependent table,
 * never assume" discipline as
 * e2e/support/phase9-fixtures.ts's deletePhase9SyntheticStudentIfSafe. The
 * caller is responsible for deleting any Enrollment created for this
 * student FIRST (deletePhase10SyntheticEnrollmentIfSafe below) — this
 * function itself refuses to proceed while one still exists (enrollments.
 * student_id is `on delete restrict`, so a raw delete would just fail
 * anyway; checking explicitly gives a clear reason instead of a raw
 * constraint-violation error).
 */
export async function deletePhase10StudentPortalIdentity(
  identity: Phase10StudentPortalIdentity,
): Promise<Phase10DeleteResult> {
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
// Read-only lookup — no Program/Batch fixtures are created for this suite,
// same reasoning and same query as
// e2e/support/phase9-fixtures.ts's findExistingProgramWithBatch, duplicated
// per this file's own header comment.

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
    .select("id, name, program_id")
    .limit(1);
  if (batchesError) {
    throw new Error(`Could not look up an existing batch: ${batchesError.message}`);
  }
  const batch = (batches ?? [])[0] as
    { id: string; name: string; program_id: string } | undefined;
  if (!batch) return null;

  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("name")
    .eq("id", batch.program_id)
    .maybeSingle();
  if (programError) {
    throw new Error(`Could not look up the batch's program: ${programError.message}`);
  }

  return {
    programId: batch.program_id,
    programName: program?.name ?? "",
    batchId: batch.id,
    batchName: batch.name,
  };
}

// ---------------------------------------------------------------------------
// Synthetic enrollments — a direct insert (mirrors how the real
// createEnrollmentRecord Server Action computes total_payable, but this
// fixture never goes through the app layer: setup data is created directly,
// only the test's own actions exercise real UI/API paths, same convention
// as every other phase's fixtures). Zero discount/registration/tax, so
// total_payable === agreedFeeRupees exactly — a "known fee" like Phase 9's
// dashboard test, for any assertion that wants one.

export async function createPhase10SyntheticEnrollment(input: {
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

export async function deletePhase10SyntheticEnrollmentIfSafe(
  enrollmentId: string,
): Promise<Phase10DeleteResult> {
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
