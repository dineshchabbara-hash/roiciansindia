import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

/**
 * Node-side setup/teardown for the Phase 9 (Enrollment Management) live-data
 * E2E suite (e2e/phase9-enrollment-management.spec.ts). Talks to Supabase
 * directly via the service-role key, same as e2e/support/phase5-fixtures.ts,
 * but is a DELIBERATELY separate, simpler implementation rather than a
 * reuse/extension of that file's cleanup logic: Phase 5's
 * deleteAuthUsersWithProfileSafety exists to sweep an accumulated,
 * multi-day backlog of orphaned accounts (paginated listing, pattern
 * matching across every historical run). Phase 9 never needs that — each
 * test always knows the exact, small number of ids it just created, so its
 * safe-delete helpers below only ever operate on ids the caller already has
 * in hand, one known id (or a short caller-supplied list) at a time, with no
 * listing/pagination/backlog-sweep step at all.
 *
 * This is intentionally NOT a .spec.ts file — Playwright would otherwise
 * try to run it as a test file itself.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Re-exported from phase5-fixtures rather than reimplemented: both suites
// need the exact same "is this a real, non-placeholder dev project"
// answer, and this check has no Phase-5-specific behavior in it.
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

export const PHASE9_E2E_EMAIL_DOMAIN = "phase9-e2e.internal.test";
export const PHASE9_E2E_STUDENT_PREFIX = "Phase9E2E";

const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------------------
// Login identities (Admin/Trainer/Student-for-auth-check) — full auth.users
// + user_roles + profile row, for real /login/<role> form submissions.
// Mirrors phase5-fixtures.ts's createFixtureUser exactly for this part
// (same tables, same "student gets no profile row" precedent) since this
// part of Phase 5's design has no backlog/pagination concerns to avoid
// duplicating — only the identification/deletion strategy below differs.

export type Phase9RoleKind = "admin" | "trainer" | "student";

export type Phase9LoginIdentity = {
  authUserId: string;
  email: string;
  password: string;
  role: Phase9RoleKind;
  hasAdminProfile: boolean;
  hasTrainerProfile: boolean;
};

/**
 * Creates one throwaway login identity. `tag` distinguishes concurrent
 * identities within the same run (e.g. "list", "workflow", "dashboard") so
 * every test's Admin fixture is a wholly independent account — no test ever
 * shares, and therefore never accumulates login attempts against, another
 * test's email (Checkpoint 3/7 requirement).
 */
export async function createPhase9LoginIdentity(
  role: Phase9RoleKind,
  tag: string,
): Promise<Phase9LoginIdentity> {
  const supabase = adminClient();
  const email = `phase9-e2e-${role}-${tag}-${RUN_ID}@${PHASE9_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Failed to create ${role} login identity: ${error?.message}`);
  }
  const authUserId = data.user.id;

  const { error: roleError } = await supabase
    .from("user_roles")
    .insert({ auth_user_id: authUserId, role });
  if (roleError) {
    throw new Error(
      `Failed to assign role ${role} to login identity: ${roleError.message}`,
    );
  }

  let hasAdminProfile = false;
  let hasTrainerProfile = false;
  if (role === "admin") {
    const { error: profileError } = await supabase.from("admins").insert({
      auth_user_id: authUserId,
      first_name: PHASE9_E2E_STUDENT_PREFIX,
      last_name: "Admin",
      email,
      role_level: "admin",
    });
    if (profileError) {
      throw new Error(`Failed to create admin profile: ${profileError.message}`);
    }
    hasAdminProfile = true;
  } else if (role === "trainer") {
    const { error: profileError } = await supabase.from("trainers").insert({
      auth_user_id: authUserId,
      first_name: PHASE9_E2E_STUDENT_PREFIX,
      last_name: "Trainer",
      email,
    });
    if (profileError) {
      throw new Error(`Failed to create trainer profile: ${profileError.message}`);
    }
    hasTrainerProfile = true;
  }
  // Student role deliberately gets no `students` row here — this identity
  // is only ever used for the authorization-blocked check (can a Student
  // role reach /admin/enrollments), never as the subject of an Enrollment.
  // Enrollment-subject students are a completely separate kind of fixture,
  // see createPhase9SyntheticStudent below.

  return { authUserId, email, password, role, hasAdminProfile, hasTrainerProfile };
}

export type Phase9DeleteResult = { ok: boolean; reason?: string };

/**
 * Runs one Supabase call and normalizes BOTH ways it can fail into the same
 * `{ error }` shape: a resolved `{ data, error }` with a real error (the
 * Admin API's usual failure mode — never assumed to mean success just
 * because the promise resolved), and a rejected promise (a genuine network
 * failure/timeout). Every safe-delete function below routes its Supabase
 * calls through this so neither failure mode can throw past this module and
 * abort a caller's afterAll partway through (e.g. skipping a later,
 * unrelated cleanup step because an earlier one rejected).
 */
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

/**
 * Deletes exactly one known login identity. Unlike Phase 5's
 * deleteAuthUsersWithProfileSafety (which sweeps a set identified by
 * listing/pattern-matching), this always knows the single id it was asked
 * to delete — no listing, no pagination, no batch. Still respects the same
 * admins/trainers.auth_user_id ON DELETE RESTRICT constraint (profile row
 * must go first) and still checks `{ error }` explicitly at every step
 * rather than assuming a resolved promise means success.
 */
export async function deletePhase9LoginIdentity(
  identity: Phase9LoginIdentity,
): Promise<Phase9DeleteResult> {
  const supabase = adminClient();

  if (identity.hasAdminProfile) {
    const { error } = await safely(() =>
      supabase.from("admins").delete().eq("auth_user_id", identity.authUserId),
    );
    if (error) {
      return { ok: false, reason: `Could not delete admin profile: ${error.message}` };
    }
  }
  if (identity.hasTrainerProfile) {
    const { error } = await safely(() =>
      supabase.from("trainers").delete().eq("auth_user_id", identity.authUserId),
    );
    if (error) {
      return { ok: false, reason: `Could not delete trainer profile: ${error.message}` };
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
// Read-only lookup — no Program/Batch fixtures are created for this suite.
// The dev project already has real Programs/Batches (11 real Enrollments
// existed at last count), so tests select from that existing data via the
// same dropdowns a real Admin would use, exactly like the corrected
// execution plan's minimal-footprint decision. This is a plain SELECT; it
// never creates, modifies, or deletes a Program/Batch row.

export type ExistingProgramWithBatch = {
  programId: string;
  programName: string;
  batchId: string;
  batchName: string;
};

/**
 * Finds one real Program that has at least one real Batch, so record-
 * changing scenarios (batch assignment, status-to-operational, duplicate
 * detection) have a genuine, already-existing (programId, batchId) pair to
 * use — rather than this suite ever creating its own throwaway Program/
 * Batch rows. Returns null if the dev project has no Program/Batch pairing
 * at all (the caller must then fail clearly, not silently skip real
 * coverage).
 */
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
// Enrollment-subject synthetic students — a plain `students` row, no auth
// account at all (students.auth_user_id is nullable — a student can exist
// before any portal login is provisioned, supabase/migrations/
// 20260101000004_identity_tables.sql:29). These exist only to be the
// `student_id` on a synthetic Enrollment; they are never logged into.

export type Phase9SyntheticStudent = { id: string; firstName: string; lastName: string };

/**
 * `tag` (e.g. "Create", "Duplicate", "BatchAssign") makes every scenario's
 * student independently identifiable by name, on top of the shared
 * PHASE9_E2E_STUDENT_PREFIX first-name prefix and phase9-e2e.internal.test
 * email domain — matching Checkpoint 9's "identify synthetic records via
 * multiple independent signals" requirement. student_code is omitted:
 * it is DB-generated from student_id_seq (supabase/migrations/
 * 20260101000019_student_code_default_from_sequence.sql), never supplied by
 * a caller, mirroring how the real application creates students.
 */
export async function createPhase9SyntheticStudent(
  tag: string,
): Promise<Phase9SyntheticStudent> {
  const supabase = adminClient();
  const firstName = `${PHASE9_E2E_STUDENT_PREFIX}${tag}`;
  const lastName = "Student";
  // 9200-9299 block, distinct from Phase 5's 9100-series literals in
  // e2e/phase5-student-management.spec.ts, plus a random 3-digit tail so
  // concurrent scenarios within one run don't collide.
  const phone = `92${randomInt(0, 10)}${randomInt(0, 10)}${randomInt(100, 1000)}${randomInt(100, 1000)}`;
  const email = `phase9-e2e-${tag.toLowerCase()}-${RUN_ID}@${PHASE9_E2E_EMAIL_DOMAIN}`;

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

/**
 * Deletes one known synthetic student id, but only after verifying it is
 * actually safe to remove — never assumed. Checks every table that can
 * reference a student row before deleting anything: `enrollments.student_id`
 * (the exact reason this fixture kind exists — a student that already has
 * an Enrollment attached must never be deleted out from under it),
 * `student_notes`/`student_documents` (defensive — this suite never creates
 * either, but a real student accidentally passed in here must not be
 * silently gutted), and `audit_logs` rows this suite's own enrollment
 * actions may have written against the student's own entity id (none
 * currently do — enrollment actions log entity_type: "enrollment" only —
 * but checked rather than assumed).
 */
export async function deletePhase9SyntheticStudentIfSafe(
  studentId: string,
): Promise<Phase9DeleteResult> {
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

  const { error: auditError } = await safely(() =>
    supabase
      .from("audit_logs")
      .delete()
      .eq("entity_type", "student")
      .eq("entity_id", studentId),
  );
  if (auditError) {
    return {
      ok: false,
      reason: `Could not delete student's own audit_logs rows: ${auditError.message}`,
    };
  }

  const { error: deleteError } = await safely(() =>
    supabase.from("students").delete().eq("id", studentId),
  );
  if (deleteError) {
    return { ok: false, reason: `Could not delete student: ${deleteError.message}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Synthetic enrollments — deleted only after checking every table that
// references enrollments.id, verified directly from the migrations rather
// than assumed:
//   payment_plans.enrollment_id  ON DELETE CASCADE  (20260101000006_enrollment_tables.sql:89)
//   payments.enrollment_id       ON DELETE RESTRICT (20260101000007_payment_tables.sql:10)
//   attendance.enrollment_id     ON DELETE CASCADE  (20260101000008_academic_tables.sql:31)
//   assignment_submissions.enrollment_id ON DELETE CASCADE (20260101000008_academic_tables.sql:158)
//   certificates.enrollment_id   ON DELETE RESTRICT (20260101000009_certificates_leads_notifications.sql:6)
// Even the CASCADE-marked tables are checked and treated as blocking here,
// not relied upon to cascade silently — this suite never creates rows in
// any of them, so a hit means something unexpected is attached and deletion
// must be skipped and reported, never forced through.

const ENROLLMENT_DEPENDENT_TABLES = [
  "payment_plans",
  "payments",
  "attendance",
  "assignment_submissions",
  "certificates",
] as const;

export async function deletePhase9SyntheticEnrollmentIfSafe(
  enrollmentId: string,
): Promise<Phase9DeleteResult> {
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
      return { ok: false, reason: `Enrollment still has ${table} rows; skipped.` };
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
