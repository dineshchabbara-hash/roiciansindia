import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

/**
 * Node-side setup/teardown for the Phase 17 (Certificates) live-data E2E
 * suite (e2e/phase17-certificates.spec.ts). A deliberately separate,
 * self-contained implementation from e2e/support/phase16-fixtures.ts, same
 * reasoning as every prior phase's own fixtures file header comment for
 * why it doesn't reuse the previous phase's — each phase's fixtures/
 * markers must be independently auditable. Only the environment check
 * (hasRealSupabaseCredentials) is re-exported, since it has no
 * phase-specific behavior at all.
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

export const PHASE17_E2E_EMAIL_DOMAIN = "phase17-e2e.internal.test";
export const PHASE17_E2E_PREFIX = "Phase17E2E";

export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export type Phase17DeleteResult = { ok: boolean; reason?: string };

// A real %PDF-4-byte-signature buffer, distinctly marked per run — used
// only by createPhase17CertificateDirect below (the Admin-issuance test
// itself exercises the real renderCertificatePdf path through the running
// app, never this synthetic buffer).
export function buildPhase17FixtureCertificatePdf(): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${PHASE17_E2E_PREFIX} ${RUN_ID} synthetic certificate file.\n%%EOF\n`,
  );
}

// ---------------------------------------------------------------------------
// Admin login identity.

export type Phase17AdminIdentity = {
  authUserId: string;
  email: string;
  password: string;
  hasProfile: boolean;
};

export class Phase17PartialAdminIdentityError extends Error {
  partial: Phase17AdminIdentity;
  constructor(message: string, partial: Phase17AdminIdentity) {
    super(message);
    this.name = "Phase17PartialAdminIdentityError";
    this.partial = partial;
  }
}

export async function createPhase17AdminIdentity(
  tag: string,
): Promise<Phase17AdminIdentity> {
  const supabase = adminClient();
  const email = `phase17-e2e-admin-${tag.toLowerCase()}-${RUN_ID}@${PHASE17_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(`Failed to create admin identity (${tag}): ${error?.message}`);
  }
  const authUserId = data.user.id;

  let partial: Phase17AdminIdentity = { authUserId, email, password, hasProfile: false };

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: authUserId, role: "admin" }),
  );
  if (roleError) {
    throw new Phase17PartialAdminIdentityError(
      `Failed to assign admin role (auth user WAS already created): ${roleError.message}`,
      partial,
    );
  }

  const { error: profileError } = await safely(() =>
    supabase.from("admins").insert({
      auth_user_id: authUserId,
      first_name: PHASE17_E2E_PREFIX,
      last_name: "Admin",
      email,
      role_level: "admin",
    }),
  );
  if (profileError) {
    throw new Phase17PartialAdminIdentityError(
      `Failed to create admin profile (auth user + user_roles WERE already created): ${profileError.message}`,
      partial,
    );
  }
  partial = { ...partial, hasProfile: true };

  return partial;
}

export async function deletePhase17AdminIdentity(
  identity: Phase17AdminIdentity,
): Promise<Phase17DeleteResult> {
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
// Student Portal identity.

export type Phase17StudentPortalIdentity = {
  authUserId: string;
  email: string;
  password: string;
  studentId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase17PartialStudentPortalIdentityError extends Error {
  partial: Phase17StudentPortalIdentity;
  constructor(message: string, partial: Phase17StudentPortalIdentity) {
    super(message);
    this.name = "Phase17PartialStudentPortalIdentityError";
    this.partial = partial;
  }
}

export async function createPhase17StudentPortalIdentity(
  tag: string,
): Promise<Phase17StudentPortalIdentity> {
  const supabase = adminClient();
  const firstName = `${PHASE17_E2E_PREFIX}${tag}`;
  const lastName = "Student";
  const email = `phase17-e2e-student-${tag.toLowerCase()}-${RUN_ID}@${PHASE17_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();
  // Distinct phone block from every other phase's own literal/random block
  // (see e2e/support/phase15-fixtures.ts's own comment for the running
  // ledger) — 9902-... here, distinct from Phase16's 9901-9999 block.
  const phone = `9902${randomInt(10, 100)}${randomInt(1000, 10000)}`.slice(0, 10);

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(
      `Failed to create student portal identity (${tag}): ${error?.message}`,
    );
  }
  const authUserId = data.user.id;

  let partial: Phase17StudentPortalIdentity = {
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
    throw new Phase17PartialStudentPortalIdentityError(
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
    throw new Phase17PartialStudentPortalIdentityError(
      `Failed to create students row (auth user + user_roles WERE already created): ${studentError?.message}`,
      partial,
    );
  }
  partial = { ...partial, studentId: studentRow.id };

  return partial;
}

export async function deletePhase17StudentPortalIdentity(
  identity: Phase17StudentPortalIdentity,
): Promise<Phase17DeleteResult> {
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
// findExistingProgramWithBatch (duplicated here, not imported). Filters to
// a certificate_eligible=true Program specifically — programs.
// certificate_eligible defaults to true (DATABASE_SCHEMA.md §7), but this
// suite's eligibility-dependent tests must never assume that rather than
// checking it.

export type ExistingCertificateEligibleProgramWithBatch = {
  programId: string;
  programName: string;
  batchId: string;
  batchName: string;
};

export async function findExistingCertificateEligibleProgramWithBatch(): Promise<ExistingCertificateEligibleProgramWithBatch | null> {
  const supabase = adminClient();
  const { data: batches, error: batchesError } = await supabase
    .from("batches")
    .select("id, name, program_id, program:programs!inner(name, certificate_eligible)")
    .eq("program.certificate_eligible", true)
    .order("id", { ascending: true })
    .limit(1);
  if (batchesError) {
    throw new Error(`Could not look up an existing batch: ${batchesError.message}`);
  }
  const rows = (batches ?? []) as unknown as Array<{
    id: string;
    name: string;
    program_id: string;
    program: { name: string; certificate_eligible: boolean } | null;
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
// Enrollment — totalPayableRupees controls the outstanding-balance leg of
// eligibility directly (no payments row needs to be seeded at all): 0
// means already cleared, >0 means genuinely outstanding since no payment
// exists against it.

export async function createPhase17SyntheticEnrollment(input: {
  studentId: string;
  programId: string;
  batchId: string;
  totalPayableRupees: number;
  status: "completed" | "active";
}): Promise<string> {
  const supabase = adminClient();
  const fee = `${input.totalPayableRupees}.00`;
  const { data, error } = await supabase
    .from("enrollments")
    .insert({
      student_id: input.studentId,
      program_id: input.programId,
      batch_id: input.batchId,
      regular_fee: fee,
      agreed_fee: fee,
      total_payable: fee,
      status: input.status,
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

export async function deletePhase17SyntheticEnrollmentIfSafe(
  enrollmentId: string,
): Promise<Phase17DeleteResult> {
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
// Direct certificate creation — a service-role insert (number minted via
// the real generate_certificate_number() RPC, service_role keeps its own
// default EXECUTE grant on it — 20260101000031 only revokes public/anon/
// authenticated) for tests whose purpose is NOT proving issuance itself
// (the Admin-issuance test exercises the real UI -> renderCertificatePdf
// -> upload -> insert path separately). Same "direct creation for a test
// that needs a real pre-existing row" precedent as Phase 16's own
// createPhase16AssignmentDirect.

export async function createPhase17CertificateDirect(input: {
  enrollmentId: string;
  studentId: string;
  programId: string;
  completionDate: string;
}): Promise<{ id: string; certificateNumber: string; pdfPath: string }> {
  const supabase = adminClient();

  const { data: minted, error: rpcError } = await supabase.rpc(
    "generate_certificate_number",
  );
  if (rpcError || !minted) {
    throw new Error(`Failed to mint a certificate number: ${rpcError?.message}`);
  }
  const certificateNumber = minted as string;
  const pdfPath = `${input.studentId}/${certificateNumber}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from("certificates")
    .upload(pdfPath, buildPhase17FixtureCertificatePdf(), {
      contentType: "application/pdf",
    });
  if (uploadError) {
    throw new Error(`Failed to upload fixture certificate PDF: ${uploadError.message}`);
  }

  const { data, error } = await supabase
    .from("certificates")
    .insert({
      certificate_number: certificateNumber,
      enrollment_id: input.enrollmentId,
      student_id: input.studentId,
      program_id: input.programId,
      completion_date: input.completionDate,
      issue_date: input.completionDate,
      status: "issued",
      pdf_path: pdfPath,
    })
    .select("id")
    .single();
  if (error || !data) {
    await safely(() => supabase.storage.from("certificates").remove([pdfPath]));
    throw new Error(`Failed to insert fixture certificate row: ${error?.message}`);
  }
  return { id: data.id, certificateNumber, pdfPath };
}

export async function deletePhase17CertificateIfExists(
  certificateId: string,
  pdfPath: string,
): Promise<Phase17DeleteResult> {
  const supabase = adminClient();

  const { error: storageError } = await safely(() =>
    supabase.storage.from("certificates").remove([pdfPath]),
  );
  if (storageError) {
    return {
      ok: false,
      reason: `Could not remove certificate Storage object (${pdfPath}): ${storageError.message}`,
    };
  }

  // service_role has BYPASSRLS — this delete works regardless of the fact
  // that no certificates_delete_* policy exists for any application role
  // (no hard-delete UI is ever exposed to Admin/Student/Trainer; cleanup
  // here is test-infrastructure-only, not a UI-reachable action).
  const { error: deleteError } = await safely(() =>
    supabase.from("certificates").delete().eq("id", certificateId),
  );
  if (deleteError) {
    return {
      ok: false,
      reason: `Could not delete certificate row: ${deleteError.message}`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// UI-driven certificate cleanup — the Admin-issuance test issues a
// certificate through the actual running app (never createPhase17CertificateDirect
// above), so no caller-side certificate id is returned to the test. Looks
// up by its own exact (enrollment_id, certificate_number) pair.

export async function deletePhase17CertificateByNumberIfExists(
  enrollmentId: string,
  certificateNumber: string,
): Promise<Phase17DeleteResult> {
  const supabase = adminClient();

  const { data: certificate, error: lookupError } = await safely<{
    id: string;
    pdf_path: string;
  }>(() =>
    supabase
      .from("certificates")
      .select("id, pdf_path")
      .eq("enrollment_id", enrollmentId)
      .eq("certificate_number", certificateNumber)
      .maybeSingle(),
  );
  if (lookupError) {
    return {
      ok: false,
      reason: `Could not look up the certificate: ${lookupError.message}`,
    };
  }
  if (!certificate) return { ok: true };

  return deletePhase17CertificateIfExists(certificate.id, certificate.pdf_path);
}

// Removes every certificate row/object for one Enrollment — used only to
// clean up a whole reissue chain (original + replacement), whose exact
// certificate_numbers are server-minted and not known to the caller ahead
// of time. Still exact-id/exact-object only underneath (iterates the real
// rows for this one synthetic Enrollment, never a broader filter).
export async function deletePhase17AllCertificatesForEnrollment(
  enrollmentId: string,
): Promise<Phase17DeleteResult> {
  const supabase = adminClient();

  const { data: certificates, error: lookupError } = await safely<
    Array<{ id: string; pdf_path: string }>
  >(() =>
    supabase
      .from("certificates")
      .select("id, pdf_path")
      .eq("enrollment_id", enrollmentId),
  );
  if (lookupError) {
    return {
      ok: false,
      reason: `Could not look up certificates for the enrollment: ${lookupError.message}`,
    };
  }

  for (const certificate of certificates ?? []) {
    const result = await deletePhase17CertificateIfExists(
      certificate.id,
      certificate.pdf_path,
    );
    if (!result.ok) return result;
  }
  return { ok: true };
}
