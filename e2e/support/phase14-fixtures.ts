import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

/**
 * Node-side setup/teardown for the Phase 14 (Payment Plans & Financial
 * Engine) live-data E2E suite (e2e/phase14-financial-engine.spec.ts). A
 * deliberately separate, self-contained implementation from
 * e2e/support/phase13-fixtures.ts, same reasoning as that file's own header
 * comment for why it doesn't reuse Phase 12's — each phase's fixtures/
 * markers must be independently auditable. Only the environment check
 * (hasRealSupabaseCredentials) is re-exported, since it has no
 * phase-specific behavior at all.
 *
 * Payment Plans have no Trainer access at all (RLS grants zero trainer
 * policies on payment_plans/installments — see supabase/tests/
 * phase14_financial_engine_test.sql), so unlike Phase 12/13's fixtures,
 * this file never creates a Trainer identity or a Batch pair — only one
 * real existing Program+Batch is needed (to attach synthetic Enrollments
 * to), and isolation is proven across Students, not Batches.
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

// Same double-failure-mode normalization as e2e/support/phase9-fixtures.ts's
// safely() / e2e/support/phase13-fixtures.ts's own copy — see either's own
// doc comment.
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

export const PHASE14_E2E_EMAIL_DOMAIN = "phase14-e2e.internal.test";
export const PHASE14_E2E_PREFIX = "Phase14E2E";

export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export type Phase14DeleteResult = { ok: boolean; reason?: string };

// ---------------------------------------------------------------------------
// Admin login identity — full auth.users + user_roles('admin') + an admins
// row, same shape as e2e/support/phase13-fixtures.ts's own admin identity.

export type Phase14AdminIdentity = {
  authUserId: string;
  email: string;
  password: string;
  hasProfile: boolean;
};

export class Phase14PartialAdminIdentityError extends Error {
  partial: Phase14AdminIdentity;
  constructor(message: string, partial: Phase14AdminIdentity) {
    super(message);
    this.name = "Phase14PartialAdminIdentityError";
    this.partial = partial;
  }
}

export async function createPhase14AdminIdentity(
  tag: string,
): Promise<Phase14AdminIdentity> {
  const supabase = adminClient();
  const email = `phase14-e2e-admin-${tag.toLowerCase()}-${RUN_ID}@${PHASE14_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(`Failed to create admin identity (${tag}): ${error?.message}`);
  }
  const authUserId = data.user.id;

  let partial: Phase14AdminIdentity = { authUserId, email, password, hasProfile: false };

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: authUserId, role: "admin" }),
  );
  if (roleError) {
    throw new Phase14PartialAdminIdentityError(
      `Failed to assign admin role (auth user WAS already created): ${roleError.message}`,
      partial,
    );
  }

  const { error: profileError } = await safely(() =>
    supabase.from("admins").insert({
      auth_user_id: authUserId,
      first_name: PHASE14_E2E_PREFIX,
      last_name: "Admin",
      email,
      role_level: "admin",
    }),
  );
  if (profileError) {
    throw new Phase14PartialAdminIdentityError(
      `Failed to create admin profile (auth user + user_roles WERE already created): ${profileError.message}`,
      partial,
    );
  }
  partial = { ...partial, hasProfile: true };

  return partial;
}

export async function deletePhase14AdminIdentity(
  identity: Phase14AdminIdentity,
): Promise<Phase14DeleteResult> {
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
// + a students row, duplicated from e2e/support/phase13-fixtures.ts's own
// shape.

export type Phase14StudentPortalIdentity = {
  authUserId: string;
  email: string;
  password: string;
  studentId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase14PartialStudentPortalIdentityError extends Error {
  partial: Phase14StudentPortalIdentity;
  constructor(message: string, partial: Phase14StudentPortalIdentity) {
    super(message);
    this.name = "Phase14PartialStudentPortalIdentityError";
    this.partial = partial;
  }
}

export async function createPhase14StudentPortalIdentity(
  tag: string,
): Promise<Phase14StudentPortalIdentity> {
  const supabase = adminClient();
  const firstName = `${PHASE14_E2E_PREFIX}${tag}`;
  const lastName = "Student";
  const email = `phase14-e2e-student-${tag.toLowerCase()}-${RUN_ID}@${PHASE14_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();
  // 9800-9899 block — distinct from every other phase's own literal/random
  // phone block (Phase 5: 9100s, Phase 9: 9200s, Phase 10: 9300s, Phase 11:
  // 9400s/9500s, Phase 12: 9600s, Phase 13: 9700s).
  const phone = `98${randomInt(0, 10)}${randomInt(0, 10)}${randomInt(100, 1000)}${randomInt(100, 1000)}`;

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(
      `Failed to create student portal identity (${tag}): ${error?.message}`,
    );
  }
  const authUserId = data.user.id;

  let partial: Phase14StudentPortalIdentity = {
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
    throw new Phase14PartialStudentPortalIdentityError(
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
    throw new Phase14PartialStudentPortalIdentityError(
      `Failed to create students row (auth user + user_roles WERE already created): ${studentError?.message}`,
      partial,
    );
  }
  partial = { ...partial, studentId: studentRow.id };

  return partial;
}

export async function deletePhase14StudentPortalIdentity(
  identity: Phase14StudentPortalIdentity,
): Promise<Phase14DeleteResult> {
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
// this suite, same reasoning as e2e/support/phase13-fixtures.ts's own
// findTwoExistingProgramsWithBatches, but only ONE pair is needed here:
// Payment Plan isolation is proven across Students (payment_plans_select_own
// scopes by the owning Enrollment's student_id), not across Batches — there
// is no Trainer-facing batch-scoping concern for financial data at all.

export type ExistingProgramWithBatch = {
  programId: string;
  programName: string;
  batchId: string;
  batchName: string;
};

// Pre-acceptance review correction: this used to pick the first existing
// Batch/Program pair with no eligibility filter at all. That is safe for
// every use except the Admin "create a plan" test's own 2-line submission
// (components/admin/payment-plans/create-payment-plan-form.tsx's UI flow),
// which lib/data/payment-plans.ts's own createPaymentPlanForEnrollment
// correctly rejects with a formError whenever the chosen Program has
// installments_allowed=false — proven the real cause of a live Windows
// failure (a rendered alert, not a timeout) once the dev project's first
// Batch by id happened to belong to such a Program. Filtering server-side
// for installments_allowed=true (the same `!inner` embed + dot-filter
// pattern lib/data/enrollments.ts's own FR-31 balance calculation already
// uses against `payments`) makes every Phase 14 fixture caller use a
// genuinely eligible Program — harmless for the Student describe block's
// own direct-inserted single-line plans, which were never gated by this
// flag either way. Never toggles the flag on real data; if no eligible
// Program/Batch exists at all, this returns null and the existing caller
// already throws a clear "No existing Batch was found" error rather than
// silently using an ineligible one.
export async function findExistingProgramWithBatch(): Promise<ExistingProgramWithBatch | null> {
  const supabase = adminClient();
  const { data: batches, error: batchesError } = await supabase
    .from("batches")
    .select("id, name, program_id, program:programs!inner(name, installments_allowed)")
    .eq("program.installments_allowed", true)
    .order("id", { ascending: true })
    .limit(1);
  if (batchesError) {
    throw new Error(`Could not look up an existing batch: ${batchesError.message}`);
  }
  const rows = (batches ?? []) as unknown as Array<{
    id: string;
    name: string;
    program_id: string;
    program: { name: string; installments_allowed: boolean } | null;
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
// Enrollment — ties a real Student Portal identity to a real (program,
// batch) pair, same shape as e2e/support/phase13-fixtures.ts's own
// createPhase13SyntheticEnrollment, so payment_plans_select_own eligibility
// has something real to scope against for that student.

export async function createPhase14SyntheticEnrollment(input: {
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

export async function deletePhase14SyntheticEnrollmentIfSafe(
  enrollmentId: string,
): Promise<Phase14DeleteResult> {
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
// Payment plan — a direct service-role insert (plan + installments) for
// tests whose purpose is NOT proving creation itself (already covered by
// this suite's own UI-driven "Admin creates a plan" test): the Student
// visibility test needs a real, already-created plan to read, not to
// create one through the UI.

export async function createPhase14PaymentPlanDirect(input: {
  enrollmentId: string;
  installments: Array<{ label: string | null; amount: string; dueDate: string }>;
}): Promise<{ planId: string; installmentIds: string[] }> {
  const supabase = adminClient();
  const totalAmount = input.installments.reduce(
    (sum, i) => sum + Math.round(parseFloat(i.amount) * 100),
    0,
  );
  const totalAmountDecimal = (totalAmount / 100).toFixed(2);

  const { data: plan, error: planError } = await supabase
    .from("payment_plans")
    .insert({ enrollment_id: input.enrollmentId, total_amount: totalAmountDecimal })
    .select("id")
    .single();
  if (planError || !plan) {
    throw new Error(`Failed to create payment_plans fixture: ${planError?.message}`);
  }

  const { data: installments, error: installmentsError } = await supabase
    .from("installments")
    .insert(
      input.installments.map((line, index) => ({
        payment_plan_id: plan.id,
        sequence: index + 1,
        label: line.label,
        amount: line.amount,
        due_date: line.dueDate,
      })),
    )
    .select("id");
  if (installmentsError) {
    await supabase.from("payment_plans").delete().eq("id", plan.id);
    throw new Error(
      `Failed to create installments fixture: ${installmentsError.message}`,
    );
  }

  return {
    planId: plan.id,
    installmentIds: ((installments ?? []) as Array<{ id: string }>).map((r) => r.id),
  };
}

// Checks `payments` before deleting each installment (never relies on
// cascade) — same "check first, never force" convention as
// e2e/support/phase13-fixtures.ts's own delete-if-safe helpers.
export async function deletePhase14PaymentPlanIfSafe(
  planId: string,
): Promise<Phase14DeleteResult> {
  const supabase = adminClient();

  const { data: installments, error: installmentsError } = await safely<
    Array<{ id: string }>
  >(() => supabase.from("installments").select("id").eq("payment_plan_id", planId));
  if (installmentsError) {
    return {
      ok: false,
      reason: `Could not look up installments for plan: ${installmentsError.message}`,
    };
  }

  for (const installment of installments ?? []) {
    const { data: referencingPayments, error: paymentsError } = await safely<
      Array<{ id: string }>
    >(() =>
      supabase
        .from("payments")
        .select("id")
        .eq("installment_id", installment.id)
        .limit(1),
    );
    if (paymentsError) {
      return {
        ok: false,
        reason: `Could not check payments dependents for installment ${installment.id}: ${paymentsError.message}`,
      };
    }
    if ((referencingPayments ?? []).length > 0) {
      return {
        ok: false,
        reason: `Installment ${installment.id} still has a payments row; skipped.`,
      };
    }
  }

  const { error: deleteInstallmentsError } = await safely(() =>
    supabase.from("installments").delete().eq("payment_plan_id", planId),
  );
  if (deleteInstallmentsError) {
    return {
      ok: false,
      reason: `Could not delete installments: ${deleteInstallmentsError.message}`,
    };
  }

  const { error: deletePlanError } = await safely(() =>
    supabase.from("payment_plans").delete().eq("id", planId),
  );
  if (deletePlanError) {
    return {
      ok: false,
      reason: `Could not delete payment plan: ${deletePlanError.message}`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// UI-driven payment plan cleanup — the Admin "(B) create" and "(C) edit"
// tests create/modify a payment_plans + installments chain through the
// actual running app (never through createPhase14PaymentPlanDirect above),
// so no caller-side plan id is ever returned to the test for it to track.
// Looks up the plan by its own exact enrollment_id — a synthetic id owned
// exclusively by the calling describe block's own beforeAll — rather than
// any broader filter. No-ops (ok: true) when no plan was ever created in
// this process (e.g. a sibling test in the same describe block was
// filtered out via `-g`).
export async function deletePhase14PlanForEnrollmentIfExists(
  enrollmentId: string,
): Promise<Phase14DeleteResult> {
  const supabase = adminClient();

  const { data: plan, error: planError } = await safely<{ id: string }>(() =>
    supabase
      .from("payment_plans")
      .select("id")
      .eq("enrollment_id", enrollmentId)
      .maybeSingle(),
  );
  if (planError) {
    return { ok: false, reason: `Could not look up the plan: ${planError.message}` };
  }
  if (!plan) return { ok: true };

  return deletePhase14PaymentPlanIfSafe(plan.id);
}
