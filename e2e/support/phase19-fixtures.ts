import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

/**
 * Node-side setup/teardown for the Phase 19 (Reports & Analytics) live-data
 * E2E suite (e2e/phase19-reports.spec.ts). A self-contained implementation,
 * same reasoning as every prior phase's own fixtures file: each phase's
 * fixtures/markers must be independently auditable. Only the environment
 * check (hasRealSupabaseCredentials) is re-exported.
 *
 * The service-role client below is used ONLY to create and remove this
 * suite's own synthetic rows. It is never used as proof of authorization:
 * every report/export assertion in the spec goes through the running app
 * with a real signed-in Admin, Trainer or Student browser session (or no
 * session at all), so the app's own gates and RLS decide what is visible.
 *
 * Markers: every synthetic auth email is on @phase19-e2e.internal.test,
 * every synthetic name starts with "Phase19E2E", and every synthetic
 * payment_code starts with "PHASE19E2E-<RUN_ID>-". Cleanup is by exact id
 * only, children before parents (refunds -> payments -> enrollments ->
 * students -> profiles/auth users); each delete first checks for any
 * remaining dependent row and refuses rather than cascading. audit_logs are
 * never touched (this suite performs no audited action).
 *
 * This is intentionally NOT a .spec.ts file.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export { hasRealSupabaseCredentials } from "./phase5-fixtures";

export const PHASE19_E2E_EMAIL_DOMAIN = "phase19-e2e.internal.test";
export const PHASE19_E2E_PREFIX = "Phase19E2E";
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * First name (and search term) for one describe block's synthetic report
 * students: unique per run AND per block, so two blocks never see each
 * other's rows whatever order their hooks run in.
 */
export function phase19Marker(block: string): string {
  return `${PHASE19_E2E_PREFIX}${RUN_ID}${block}`;
}

export type Phase19DeleteResult = { ok: boolean; reason?: string };

function serviceClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing real Supabase credentials — call hasRealSupabaseCredentials() first.",
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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

// Distinct phone block from every earlier phase's (9904-...).
function syntheticPhone(): string {
  return `9904${randomInt(10, 100)}${randomInt(1000, 10000)}`.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Login identities (Admin, Trainer, Student): auth user + user_roles +
// profile row.

export type Phase19Role = "admin" | "trainer" | "student";

export type Phase19Identity = {
  role: Phase19Role;
  authUserId: string;
  email: string;
  password: string;
  profileId: string | null;
};

export class Phase19PartialIdentityError extends Error {
  partial: Phase19Identity;
  constructor(message: string, partial: Phase19Identity) {
    super(message);
    this.name = "Phase19PartialIdentityError";
    this.partial = partial;
  }
}

const PROFILE_TABLE: Record<Phase19Role, "admins" | "trainers" | "students"> = {
  admin: "admins",
  trainer: "trainers",
  student: "students",
};

export async function createPhase19Identity(
  role: Phase19Role,
  tag: string,
): Promise<Phase19Identity> {
  const supabase = serviceClient();
  const email = `phase19-e2e-${role}-${tag.toLowerCase()}-${RUN_ID}@${PHASE19_E2E_EMAIL_DOMAIN}`;
  const password = randomBytes(18).toString("base64url");

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(`Failed to create ${role} identity (${tag}): ${error?.message}`);
  }

  let partial: Phase19Identity = {
    role,
    authUserId: data.user.id,
    email,
    password,
    profileId: null,
  };

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: partial.authUserId, role }),
  );
  if (roleError) {
    throw new Phase19PartialIdentityError(
      `Failed to assign ${role} role (auth user WAS already created): ${roleError.message}`,
      partial,
    );
  }

  const extra =
    role === "admin"
      ? { role_level: "admin" }
      : role === "student"
        ? { phone: syntheticPhone() }
        : {};
  const { data: profileRow, error: profileError } = await safely<{ id: string }>(() =>
    supabase
      .from(PROFILE_TABLE[role])
      .insert({
        auth_user_id: partial.authUserId,
        first_name: `${PHASE19_E2E_PREFIX}${tag}`,
        last_name:
          role === "admin" ? "Admin" : role === "trainer" ? "Trainer" : "Student",
        email,
        ...extra,
      })
      .select("id")
      .single(),
  );
  if (profileError || !profileRow) {
    throw new Phase19PartialIdentityError(
      `Failed to create ${PROFILE_TABLE[role]} row (auth user + user_roles WERE already created): ${profileError?.message}`,
      partial,
    );
  }
  partial = { ...partial, profileId: profileRow.id };
  return partial;
}

export async function deletePhase19Identity(
  identity: Phase19Identity,
): Promise<Phase19DeleteResult> {
  const supabase = serviceClient();

  if (identity.profileId) {
    if (identity.role === "student") {
      const { data, error } = await safely(() =>
        supabase
          .from("enrollments")
          .select("id")
          .eq("student_id", identity.profileId)
          .limit(1),
      );
      if (error) {
        return { ok: false, reason: `Could not check enrollments: ${error.message}` };
      }
      if ((data ?? []).length > 0) {
        return { ok: false, reason: "Student still has an enrollment; skipped." };
      }
    }
    const { error } = await safely(() =>
      supabase.from(PROFILE_TABLE[identity.role]).delete().eq("id", identity.profileId),
    );
    if (error) {
      return {
        ok: false,
        reason: `Could not delete ${PROFILE_TABLE[identity.role]} row: ${error.message}`,
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
// Report data: synthetic students (no login), enrollments, payments and
// refunds. Every created id is recorded in a Phase19Tracked ledger by the
// caller BEFORE anything else can fail, so cleanup always knows it.

export type Phase19Tracked = {
  identities: Phase19Identity[];
  studentIds: string[];
  enrollmentIds: string[];
  paymentIds: string[];
  refundIds: string[];
};

export function newPhase19Tracked(): Phase19Tracked {
  return {
    identities: [],
    studentIds: [],
    enrollmentIds: [],
    paymentIds: [],
    refundIds: [],
  };
}

export type Phase19Student = {
  id: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  registrationDate: string;
};

export async function createPhase19Student(
  tracked: Phase19Tracked,
  input: { marker: string; lastName: string; status: "active" | "inactive" },
): Promise<Phase19Student> {
  const supabase = serviceClient();
  const email = `phase19-e2e-report-${input.lastName.toLowerCase()}-${RUN_ID}@${PHASE19_E2E_EMAIL_DOMAIN}`;
  const { data, error } = await supabase
    .from("students")
    .insert({
      first_name: input.marker,
      last_name: input.lastName,
      email,
      phone: syntheticPhone(),
      status: input.status,
    })
    .select("id, student_code, first_name, last_name, email, phone, registration_date")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create synthetic student: ${error?.message}`);
  }
  tracked.studentIds.push(data.id);
  return {
    id: data.id,
    studentCode: data.student_code,
    firstName: data.first_name,
    lastName: data.last_name,
    email: data.email,
    phone: data.phone,
    registrationDate: data.registration_date,
  };
}

export type ExistingProgramWithBatch = {
  programId: string;
  programName: string;
  batchId: string;
  batchName: string;
};

// Read-only lookup — this suite never creates Program/Batch rows.
export async function findExistingProgramWithBatch(): Promise<ExistingProgramWithBatch | null> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("batches")
    .select("id, name, program_id, program:programs!inner(name)")
    .order("id", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Could not look up an existing batch: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
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

export type Phase19Enrollment = {
  id: string;
  enrollmentCode: string;
  enrollmentDate: string;
};

export async function createPhase19Enrollment(
  tracked: Phase19Tracked,
  input: {
    studentId: string;
    programId: string;
    batchId: string;
    totalPayable: string;
    status: "active" | "cancelled";
  },
): Promise<Phase19Enrollment> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("enrollments")
    .insert({
      student_id: input.studentId,
      program_id: input.programId,
      batch_id: input.batchId,
      regular_fee: input.totalPayable,
      agreed_fee: input.totalPayable,
      total_payable: input.totalPayable,
      status: input.status,
    })
    .select("id, enrollment_code, enrollment_date")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create synthetic enrollment: ${error?.message}`);
  }
  tracked.enrollmentIds.push(data.id);
  return {
    id: data.id,
    enrollmentCode: data.enrollment_code,
    enrollmentDate: data.enrollment_date,
  };
}

let paymentSequence = 0;

export async function createPhase19Payment(
  tracked: Phase19Tracked,
  input: {
    enrollmentId: string;
    studentId: string;
    totalAmount: string;
    status: "paid" | "pending";
  },
): Promise<string> {
  const supabase = serviceClient();
  paymentSequence += 1;
  const { data, error } = await supabase
    .from("payments")
    .insert({
      payment_code: `PHASE19E2E-${RUN_ID}-${paymentSequence}`,
      student_id: input.studentId,
      enrollment_id: input.enrollmentId,
      payment_type: "partial",
      amount: input.totalAmount,
      tax_amount: "0.00",
      total_amount: input.totalAmount,
      method: "cash",
      status: input.status,
      paid_at: input.status === "paid" ? new Date().toISOString() : null,
      notes: `${PHASE19_E2E_PREFIX} ${RUN_ID} synthetic payment`,
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(`Failed to create synthetic payment: ${error?.message}`);
  tracked.paymentIds.push(data.id);
  return data.id;
}

export async function createPhase19Refund(
  tracked: Phase19Tracked,
  input: { paymentId: string; amount: string; status: "processed" | "initiated" },
): Promise<string> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("payment_refunds")
    .insert({
      payment_id: input.paymentId,
      amount: input.amount,
      status: input.status,
      reason: `${PHASE19_E2E_PREFIX} ${RUN_ID} synthetic refund`,
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(`Failed to create synthetic refund: ${error?.message}`);
  tracked.refundIds.push(data.id);
  return data.id;
}

// ---------------------------------------------------------------------------
// Exact-id, FK-aware cleanup.

async function hasDependent(
  table: string,
  column: string,
  id: string,
): Promise<{ ok: true; found: boolean } | { ok: false; reason: string }> {
  const supabase = serviceClient();
  const { data, error } = await safely(() =>
    supabase.from(table).select("id").eq(column, id).limit(1),
  );
  if (error) return { ok: false, reason: `Could not check ${table}: ${error.message}` };
  return { ok: true, found: (data ?? []).length > 0 };
}

async function deleteById(table: string, id: string): Promise<Phase19DeleteResult> {
  const supabase = serviceClient();
  const { error } = await safely(() => supabase.from(table).delete().eq("id", id));
  return error
    ? { ok: false, reason: `Could not delete ${table} ${id}: ${error.message}` }
    : { ok: true };
}

const DEPENDENTS: Record<string, Array<[string, string]>> = {
  payments: [
    ["payment_refunds", "payment_id"],
    ["receipts", "payment_id"],
  ],
  enrollments: [
    ["payment_plans", "enrollment_id"],
    ["payments", "enrollment_id"],
    ["attendance", "enrollment_id"],
    ["assignment_submissions", "enrollment_id"],
    ["certificates", "enrollment_id"],
  ],
  students: [["enrollments", "student_id"]],
};

async function deleteIfSafe(table: string, id: string): Promise<Phase19DeleteResult> {
  for (const [childTable, column] of DEPENDENTS[table] ?? []) {
    const check = await hasDependent(childTable, column, id);
    if (!check.ok) return check;
    if (check.found) {
      return {
        ok: false,
        reason: `${table} ${id} still has a ${childTable} row; skipped.`,
      };
    }
  }
  return deleteById(table, id);
}

/**
 * Removes everything in the ledger, children first, by exact id. Returns
 * one message per failure (empty = fully cleaned). Never broadens a delete.
 */
export async function cleanupPhase19(tracked: Phase19Tracked): Promise<string[]> {
  const failures: string[] = [];
  const run = async (label: string, op: () => Promise<Phase19DeleteResult>) => {
    const result = await op();
    if (!result.ok) failures.push(`${label}: ${result.reason}`);
  };

  for (const id of tracked.refundIds)
    await run(`refund ${id}`, () => deleteById("payment_refunds", id));
  for (const id of tracked.paymentIds)
    await run(`payment ${id}`, () => deleteIfSafe("payments", id));
  for (const id of tracked.enrollmentIds)
    await run(`enrollment ${id}`, () => deleteIfSafe("enrollments", id));
  for (const id of tracked.studentIds)
    await run(`student ${id}`, () => deleteIfSafe("students", id));
  for (const identity of tracked.identities)
    await run(`${identity.role} ${identity.email}`, () =>
      deletePhase19Identity(identity),
    );
  return failures;
}
