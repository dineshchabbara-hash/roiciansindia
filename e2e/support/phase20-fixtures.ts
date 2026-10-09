import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

/**
 * Node-side setup/teardown for the Phase 20A (Offline Payments Ledger)
 * live-data E2E suite (e2e/phase20-offline-payments.spec.ts). A
 * self-contained implementation, same reasoning as every prior phase's own
 * fixtures file: each phase's fixtures/markers must be independently
 * auditable. Only the environment check is re-exported.
 *
 * The service-role client below is used ONLY to create and remove this
 * suite's own synthetic rows, and to READ the audit entry a recorded
 * payment produced. It never records a payment and is never used as proof
 * of authorization: every payment in this suite is recorded through the
 * running app by a real signed-in Admin browser session, so the app's own
 * gate, record_offline_payment() and RLS decide what happens.
 *
 * Markers: every synthetic auth email is on @phase20-e2e.internal.test and
 * every synthetic name starts with "Phase20E2E" plus this run's RUN_ID.
 *
 * Cleanup is by exact id only, children before parents: payments ->
 * enrollments -> students -> admin profile/auth user. Payments are
 * recorded through the UI, so their ids are captured by the spec when
 * known AND re-derived at cleanup time strictly as "payments whose
 * enrollment_id is one of THIS run's tracked synthetic enrollment ids" —
 * an exact foreign-key match, never a match by amount, date, method,
 * status or code prefix. A recorded payment's admin (created_by) is this
 * suite's own synthetic Admin, so payments are removed before that Admin.
 * audit_logs rows are append-only and are never deleted (deleting the
 * synthetic Admin's auth user sets their actor_auth_user_id to NULL via the
 * existing ON DELETE SET NULL foreign key; the rows themselves remain).
 *
 * This is intentionally NOT a .spec.ts file.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export { hasRealSupabaseCredentials } from "./phase5-fixtures";

export const PHASE20_E2E_EMAIL_DOMAIN = "phase20-e2e.internal.test";
export const PHASE20_E2E_PREFIX = "Phase20E2E";
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** First name (and search term) unique per run AND per describe block. */
export function phase20Marker(block: string): string {
  return `${PHASE20_E2E_PREFIX}${RUN_ID}${block}`;
}

export type Phase20DeleteResult = { ok: boolean; reason?: string };

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

// Distinct phone block from every earlier phase's (9905-...).
function syntheticPhone(): string {
  return `9905${randomInt(10, 100)}${randomInt(1000, 10000)}`.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Admin login identity: auth user + user_roles + admins row.

export type Phase20Admin = {
  authUserId: string;
  email: string;
  password: string;
  profileId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase20PartialIdentityError extends Error {
  partial: Phase20Admin;
  constructor(message: string, partial: Phase20Admin) {
    super(message);
    this.name = "Phase20PartialIdentityError";
    this.partial = partial;
  }
}

export async function createPhase20Admin(tag: string): Promise<Phase20Admin> {
  const supabase = serviceClient();
  const email = `phase20-e2e-admin-${tag.toLowerCase()}-${RUN_ID}@${PHASE20_E2E_EMAIL_DOMAIN}`;
  const password = randomBytes(18).toString("base64url");
  const firstName = `${PHASE20_E2E_PREFIX}${tag}`;
  const lastName = "Admin";

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(`Failed to create admin identity (${tag}): ${error?.message}`);
  }
  let partial: Phase20Admin = {
    authUserId: data.user.id,
    email,
    password,
    profileId: null,
    firstName,
    lastName,
  };

  const { error: roleError } = await safely(() =>
    supabase
      .from("user_roles")
      .insert({ auth_user_id: partial.authUserId, role: "admin" }),
  );
  if (roleError) {
    throw new Phase20PartialIdentityError(
      `Failed to assign admin role (auth user WAS already created): ${roleError.message}`,
      partial,
    );
  }

  const { data: profileRow, error: profileError } = await safely<{ id: string }>(() =>
    supabase
      .from("admins")
      .insert({
        auth_user_id: partial.authUserId,
        first_name: firstName,
        last_name: lastName,
        email,
        role_level: "admin",
      })
      .select("id")
      .single(),
  );
  if (profileError || !profileRow) {
    throw new Phase20PartialIdentityError(
      `Failed to create admins row (auth user + user_roles WERE already created): ${profileError?.message}`,
      partial,
    );
  }
  partial = { ...partial, profileId: profileRow.id };
  return partial;
}

async function deletePhase20Admin(admin: Phase20Admin): Promise<Phase20DeleteResult> {
  const supabase = serviceClient();
  if (admin.profileId) {
    const { data, error } = await safely(() =>
      supabase.from("payments").select("id").eq("created_by", admin.profileId).limit(1),
    );
    if (error) return { ok: false, reason: `Could not check payments: ${error.message}` };
    if ((data ?? []).length > 0) {
      return { ok: false, reason: "Admin still recorded a remaining payment; skipped." };
    }
    const { error: deleteError } = await safely(() =>
      supabase.from("admins").delete().eq("id", admin.profileId),
    );
    if (deleteError) {
      return { ok: false, reason: `Could not delete admins row: ${deleteError.message}` };
    }
  }
  const { error: authError } = await safely<unknown>(() =>
    supabase.auth.admin.deleteUser(admin.authUserId),
  );
  if (authError) {
    return { ok: false, reason: `Could not delete auth user: ${authError.message}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Synthetic student (no login) + enrollment on an existing Program/Batch.

export type Phase20Tracked = {
  admins: Phase20Admin[];
  studentIds: string[];
  enrollmentIds: string[];
  paymentIds: string[];
};

export function newPhase20Tracked(): Phase20Tracked {
  return { admins: [], studentIds: [], enrollmentIds: [], paymentIds: [] };
}

export type Phase20Student = { id: string; studentCode: string; name: string };

export async function createPhase20Student(
  tracked: Phase20Tracked,
  input: { marker: string; lastName: string },
): Promise<Phase20Student> {
  const supabase = serviceClient();
  const email = `phase20-e2e-student-${input.lastName.toLowerCase()}-${RUN_ID}@${PHASE20_E2E_EMAIL_DOMAIN}`;
  const { data, error } = await supabase
    .from("students")
    .insert({
      first_name: input.marker,
      last_name: input.lastName,
      email,
      phone: syntheticPhone(),
      status: "active",
    })
    .select("id, student_code, first_name, last_name")
    .single();
  if (error || !data)
    throw new Error(`Failed to create synthetic student: ${error?.message}`);
  tracked.studentIds.push(data.id);
  return {
    id: data.id,
    studentCode: data.student_code,
    name: `${data.first_name} ${data.last_name}`,
  };
}

export type ExistingProgramWithBatch = {
  programId: string;
  programName: string;
  programCode: string;
  batchId: string;
  batchName: string;
};

// Read-only lookup — this suite never creates Program/Batch rows.
export async function findExistingProgramWithBatch(): Promise<ExistingProgramWithBatch | null> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("batches")
    .select("id, name, program_id, program:programs!inner(name, program_code)")
    .order("id", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Could not look up an existing batch: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    name: string;
    program_id: string;
    program: { name: string; program_code: string } | null;
  }>;
  if (rows.length < 1) return null;
  return {
    programId: rows[0].program_id,
    programName: rows[0].program?.name ?? "",
    programCode: rows[0].program?.program_code ?? "",
    batchId: rows[0].id,
    batchName: rows[0].name,
  };
}

export type Phase20Enrollment = { id: string; enrollmentCode: string };

export async function createPhase20Enrollment(
  tracked: Phase20Tracked,
  input: { studentId: string; programId: string; batchId: string; totalPayable: string },
): Promise<Phase20Enrollment> {
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
      status: "active",
    })
    .select("id, enrollment_code")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create synthetic enrollment: ${error?.message}`);
  }
  tracked.enrollmentIds.push(data.id);
  return { id: data.id, enrollmentCode: data.enrollment_code };
}

// ---------------------------------------------------------------------------
// Read-only verification helpers.

export type Phase20AuditEntry = {
  action: string;
  entityType: string;
  actorAuthUserId: string | null;
  actorRole: string | null;
  after: Record<string, unknown> | null;
};

/** The audit entries for one exact payment id (read only). */
export async function readPaymentAuditEntries(
  paymentId: string,
): Promise<Phase20AuditEntry[]> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("action, entity_type, actor_auth_user_id, actor_role, after_data")
    .eq("entity_id", paymentId);
  if (error) throw new Error(`Could not read audit_logs: ${error.message}`);
  return (data ?? []).map((row) => ({
    action: row.action,
    entityType: row.entity_type,
    actorAuthUserId: row.actor_auth_user_id,
    actorRole: row.actor_role,
    after: row.after_data,
  }));
}

/** Count of payments on one exact enrollment id (read only). */
export async function countPaymentsForEnrollment(enrollmentId: string): Promise<number> {
  const supabase = serviceClient();
  const { count, error } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("enrollment_id", enrollmentId);
  if (error) throw new Error(`Could not count payments: ${error.message}`);
  return count ?? 0;
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

async function deleteIfSafe(table: string, id: string): Promise<Phase20DeleteResult> {
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
  const supabase = serviceClient();
  const { error } = await safely(() => supabase.from(table).delete().eq("id", id));
  return error
    ? { ok: false, reason: `Could not delete ${table} ${id}: ${error.message}` }
    : { ok: true };
}

/** Payment ids on exactly this run's tracked enrollments (exact FK match). */
async function paymentIdsOnTrackedEnrollments(
  tracked: Phase20Tracked,
): Promise<{ ids: string[]; failure?: string }> {
  if (tracked.enrollmentIds.length === 0) return { ids: [] };
  const supabase = serviceClient();
  const { data, error } = await safely<Array<{ id: string }>>(() =>
    supabase.from("payments").select("id").in("enrollment_id", tracked.enrollmentIds),
  );
  if (error) return { ids: [], failure: `Could not list payments: ${error.message}` };
  return { ids: (data ?? []).map((row) => row.id) };
}

/**
 * Removes everything this run created, children first, by exact id.
 * Returns one message per failure (empty = fully cleaned). Never broadens
 * a delete; never touches audit_logs.
 */
export async function cleanupPhase20(tracked: Phase20Tracked): Promise<string[]> {
  const failures: string[] = [];
  const run = async (label: string, op: () => Promise<Phase20DeleteResult>) => {
    const result = await op();
    if (!result.ok) failures.push(`${label}: ${result.reason}`);
  };

  const derived = await paymentIdsOnTrackedEnrollments(tracked);
  if (derived.failure) failures.push(derived.failure);
  const paymentIds = [...new Set([...tracked.paymentIds, ...derived.ids])];

  for (const id of paymentIds)
    await run(`payment ${id}`, () => deleteIfSafe("payments", id));
  for (const id of tracked.enrollmentIds)
    await run(`enrollment ${id}`, () => deleteIfSafe("enrollments", id));
  for (const id of tracked.studentIds)
    await run(`student ${id}`, () => deleteIfSafe("students", id));
  for (const admin of tracked.admins)
    await run(`admin ${admin.email}`, () => deletePhase20Admin(admin));
  return failures;
}
