import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

/**
 * Node-side setup/teardown for the Phase 16 (Assignments & Submissions)
 * live-data E2E suite (e2e/phase16-assignments.spec.ts). A deliberately
 * separate, self-contained implementation from
 * e2e/support/phase15-fixtures.ts, same reasoning as every prior phase's
 * own fixtures file header comment for why it doesn't reuse the previous
 * phase's — each phase's fixtures/markers must be independently
 * auditable. Only the environment check (hasRealSupabaseCredentials) is
 * re-exported, since it has no phase-specific behavior at all.
 *
 * This is intentionally NOT a .spec.ts file — Playwright would otherwise
 * try to run it as a test file itself.
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

export const PHASE16_E2E_EMAIL_DOMAIN = "phase16-e2e.internal.test";
export const PHASE16_E2E_PREFIX = "Phase16E2E";

export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export type Phase16DeleteResult = { ok: boolean; reason?: string };

// A real %PDF-4-byte signature (matchesAssignmentFileSignature in
// lib/domain/assignments.ts checks exactly this), plus the Phase 16
// marker text, so a successfully-uploaded object is unambiguously
// traceable to this suite's own run even by content, not just by its
// server-generated path. Never committed anywhere — built in memory per
// test run. Two distinct builders (attachment vs submission) so a test
// asserting exact-bytes equality can tell the two apart.
export function buildPhase16FixtureAttachmentPdf(): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${PHASE16_E2E_PREFIX} ${RUN_ID} synthetic assignment attachment.\n%%EOF\n`,
  );
}

export function buildPhase16FixtureSubmissionPdf(): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${PHASE16_E2E_PREFIX} ${RUN_ID} synthetic submission file.\n%%EOF\n`,
  );
}

// ---------------------------------------------------------------------------
// Admin login identity.

export type Phase16AdminIdentity = {
  authUserId: string;
  email: string;
  password: string;
  hasProfile: boolean;
};

export class Phase16PartialAdminIdentityError extends Error {
  partial: Phase16AdminIdentity;
  constructor(message: string, partial: Phase16AdminIdentity) {
    super(message);
    this.name = "Phase16PartialAdminIdentityError";
    this.partial = partial;
  }
}

export async function createPhase16AdminIdentity(
  tag: string,
): Promise<Phase16AdminIdentity> {
  const supabase = adminClient();
  const email = `phase16-e2e-admin-${tag.toLowerCase()}-${RUN_ID}@${PHASE16_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(`Failed to create admin identity (${tag}): ${error?.message}`);
  }
  const authUserId = data.user.id;

  let partial: Phase16AdminIdentity = { authUserId, email, password, hasProfile: false };

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: authUserId, role: "admin" }),
  );
  if (roleError) {
    throw new Phase16PartialAdminIdentityError(
      `Failed to assign admin role (auth user WAS already created): ${roleError.message}`,
      partial,
    );
  }

  const { error: profileError } = await safely(() =>
    supabase.from("admins").insert({
      auth_user_id: authUserId,
      first_name: PHASE16_E2E_PREFIX,
      last_name: "Admin",
      email,
      role_level: "admin",
    }),
  );
  if (profileError) {
    throw new Phase16PartialAdminIdentityError(
      `Failed to create admin profile (auth user + user_roles WERE already created): ${profileError.message}`,
      partial,
    );
  }
  partial = { ...partial, hasProfile: true };

  return partial;
}

export async function deletePhase16AdminIdentity(
  identity: Phase16AdminIdentity,
): Promise<Phase16DeleteResult> {
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
// Trainer Portal identity.

export type Phase16TrainerPortalIdentity = {
  authUserId: string;
  email: string;
  password: string;
  trainerId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase16PartialTrainerPortalIdentityError extends Error {
  partial: Phase16TrainerPortalIdentity;
  constructor(message: string, partial: Phase16TrainerPortalIdentity) {
    super(message);
    this.name = "Phase16PartialTrainerPortalIdentityError";
    this.partial = partial;
  }
}

export async function createPhase16TrainerPortalIdentity(
  tag: string,
): Promise<Phase16TrainerPortalIdentity> {
  const supabase = adminClient();
  const firstName = `${PHASE16_E2E_PREFIX}${tag}`;
  const lastName = "Trainer";
  const email = `phase16-e2e-trainer-${tag.toLowerCase()}-${RUN_ID}@${PHASE16_E2E_EMAIL_DOMAIN}`;
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

  let partial: Phase16TrainerPortalIdentity = {
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
    throw new Phase16PartialTrainerPortalIdentityError(
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
    throw new Phase16PartialTrainerPortalIdentityError(
      `Failed to create trainers row (auth user + user_roles WERE already created): ${trainerError?.message}`,
      partial,
    );
  }
  partial = { ...partial, trainerId: trainerRow.id };

  return partial;
}

export async function deletePhase16TrainerPortalIdentity(
  identity: Phase16TrainerPortalIdentity,
): Promise<Phase16DeleteResult> {
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

    const { data: assignmentsOwned, error: ownedError } = await safely(() =>
      supabase
        .from("assignments")
        .select("id")
        .eq("trainer_id", identity.trainerId)
        .limit(1),
    );
    if (ownedError) {
      return {
        ok: false,
        reason: `Could not check assignments dependents: ${ownedError.message}`,
      };
    }
    if ((assignmentsOwned ?? []).length > 0) {
      return {
        ok: false,
        reason: "Trainer still owns at least one assignment; skipped.",
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
// Student Portal identity.

export type Phase16StudentPortalIdentity = {
  authUserId: string;
  email: string;
  password: string;
  studentId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase16PartialStudentPortalIdentityError extends Error {
  partial: Phase16StudentPortalIdentity;
  constructor(message: string, partial: Phase16StudentPortalIdentity) {
    super(message);
    this.name = "Phase16PartialStudentPortalIdentityError";
    this.partial = partial;
  }
}

export async function createPhase16StudentPortalIdentity(
  tag: string,
): Promise<Phase16StudentPortalIdentity> {
  const supabase = adminClient();
  const firstName = `${PHASE16_E2E_PREFIX}${tag}`;
  const lastName = "Student";
  const email = `phase16-e2e-student-${tag.toLowerCase()}-${RUN_ID}@${PHASE16_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();
  // Distinct phone block from every other phase's own literal/random block
  // (see e2e/support/phase15-fixtures.ts's own comment for the running
  // ledger) — 9901-9999 here.
  const phone =
    `99${randomInt(10, 100)}${randomInt(100, 1000)}${randomInt(100, 1000)}`.slice(0, 10);

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(
      `Failed to create student portal identity (${tag}): ${error?.message}`,
    );
  }
  const authUserId = data.user.id;

  let partial: Phase16StudentPortalIdentity = {
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
    throw new Phase16PartialStudentPortalIdentityError(
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
    throw new Phase16PartialStudentPortalIdentityError(
      `Failed to create students row (auth user + user_roles WERE already created): ${studentError?.message}`,
      partial,
    );
  }
  partial = { ...partial, studentId: studentRow.id };

  return partial;
}

export async function deletePhase16StudentPortalIdentity(
  identity: Phase16StudentPortalIdentity,
): Promise<Phase16DeleteResult> {
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
// findExistingProgramWithBatch (duplicated here, not imported).

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
// Batch assignment.

export async function assignPhase16TrainerToBatch(
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

export async function deletePhase16BatchAssignmentIfSafe(
  batchTrainerId: string,
): Promise<Phase16DeleteResult> {
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
// Enrollment.

export async function createPhase16SyntheticEnrollment(input: {
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

export async function deletePhase16SyntheticEnrollmentIfSafe(
  enrollmentId: string,
): Promise<Phase16DeleteResult> {
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
// Assignment — a direct service-role insert for tests whose purpose is NOT
// proving creation itself: the Student visibility/submission test needs a
// real, already-created assignment to read, not to create one through the
// UI (that is covered separately by the Admin/Trainer creation tests).

export async function createPhase16AssignmentDirect(input: {
  programId: string;
  batchId: string;
  trainerId: string;
  title: string;
  dueDate: string;
}): Promise<string> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("assignments")
    .insert({
      program_id: input.programId,
      batch_id: input.batchId,
      trainer_id: input.trainerId,
      title: input.title,
      due_date: input.dueDate,
      max_marks: 100,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create assignment fixture: ${error?.message}`);
  }
  return data.id;
}

// ---------------------------------------------------------------------------
// UI-driven assignment/submission cleanup — the Admin/Trainer creation
// tests create an assignment through the actual running app (never
// through createPhase16AssignmentDirect above), so no caller-side
// assignment id is ever returned to the test for it to track. Looks up by
// its own exact (batch_id, title) pair — both already synthetic/unique to
// the calling test. Deletes any backing Storage object first (by its own
// exact stored path — never a broader prefix/directory delete), then any
// submission rows, then the assignment row itself. No-ops (ok: true) when
// no such assignment was ever created (e.g. a sibling test was filtered
// out via `-g`).

export async function deletePhase16AssignmentByTitleIfExists(
  batchId: string,
  title: string,
): Promise<Phase16DeleteResult> {
  const supabase = adminClient();

  const { data: assignment, error: lookupError } = await safely<{
    id: string;
    attachment_path: string | null;
  }>(() =>
    supabase
      .from("assignments")
      .select("id, attachment_path")
      .eq("batch_id", batchId)
      .eq("title", title)
      .maybeSingle(),
  );
  if (lookupError) {
    return {
      ok: false,
      reason: `Could not look up the assignment: ${lookupError.message}`,
    };
  }
  if (!assignment) return { ok: true };

  return deletePhase16AssignmentIfExists(assignment.id, assignment.attachment_path);
}

export async function deletePhase16AssignmentIfExists(
  assignmentId: string,
  attachmentPath: string | null,
): Promise<Phase16DeleteResult> {
  const supabase = adminClient();

  const { data: submissions, error: submissionsLookupError } = await safely<
    Array<{ id: string; file_path: string | null }>
  >(() =>
    supabase
      .from("assignment_submissions")
      .select("id, file_path")
      .eq("assignment_id", assignmentId),
  );
  if (submissionsLookupError) {
    return {
      ok: false,
      reason: `Could not look up submissions for the assignment: ${submissionsLookupError.message}`,
    };
  }

  for (const submission of submissions ?? []) {
    if (submission.file_path) {
      const { error: storageError } = await safely(() =>
        supabase.storage
          .from("assignment-submissions")
          .remove([submission.file_path as string]),
      );
      if (storageError) {
        return {
          ok: false,
          reason: `Could not remove submission Storage object (${submission.file_path}): ${storageError.message}`,
        };
      }
    }
    const { error: deleteSubmissionError } = await safely(() =>
      supabase.from("assignment_submissions").delete().eq("id", submission.id),
    );
    if (deleteSubmissionError) {
      return {
        ok: false,
        reason: `Could not delete submission row (${submission.id}): ${deleteSubmissionError.message}`,
      };
    }
  }

  if (attachmentPath) {
    const { error: storageError } = await safely(() =>
      supabase.storage.from("assignment-attachments").remove([attachmentPath]),
    );
    if (storageError) {
      return {
        ok: false,
        reason: `Could not remove attachment Storage object (${attachmentPath}): ${storageError.message}`,
      };
    }
  }

  const { error: deleteError } = await safely(() =>
    supabase.from("assignments").delete().eq("id", assignmentId),
  );
  if (deleteError) {
    return {
      ok: false,
      reason: `Could not delete assignment row: ${deleteError.message}`,
    };
  }
  return { ok: true };
}
