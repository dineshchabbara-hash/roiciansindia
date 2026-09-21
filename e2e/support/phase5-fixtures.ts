import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

/**
 * Node-side setup/teardown for the Phase 5 live-data E2E suite
 * (e2e/phase5-student-management.spec.ts). Talks to Supabase directly via
 * the service-role key — same privileged access scripts/seed-demo-users.mjs
 * uses — to create and destroy the suite's own throwaway admin/trainer/
 * student accounts and to sweep up every synthetic student record the
 * suite's browser-driven tests create along the way.
 *
 * This is intentionally NOT a .spec.ts file — Playwright would otherwise
 * try to run it as a test file itself.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * The suite only runs against a real project — never fabricates results
 * against the placeholder/unreachable config this repo ships by default.
 * See playwright.config.ts for how .env.local reaches this process at all.
 */
export function hasRealSupabaseCredentials(): boolean {
  return !!(
    SUPABASE_URL &&
    SERVICE_ROLE_KEY &&
    !SUPABASE_URL.includes("invalid-project-ref-for-testing")
  );
}

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

export type Phase5TestUser = { authUserId: string; email: string; password: string };

export type Phase5Fixtures = {
  admin: Phase5TestUser;
  superAdmin: Phase5TestUser;
  trainer: Phase5TestUser;
  student: Phase5TestUser;
};

// Fixture emails are still run-tagged (so concurrent runs, if ever needed,
// wouldn't collide) but every cleanup sweep below matches the GENERIC
// "Phase5E2E" prefix/domain, not this run's specific tag — a crashed
// previous run's leftovers get swept up by the next run's own beforeAll,
// not just its own afterAll, so the suite is self-healing rather than
// accumulating orphaned data across interrupted runs.
const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const PHASE5_E2E_EMAIL_DOMAIN = "phase5-e2e.internal.test";
export const PHASE5_E2E_STUDENT_PREFIX = "Phase5E2E";

type RoleKind = "admin" | "super_admin" | "trainer" | "student";

async function createFixtureUser(role: RoleKind): Promise<Phase5TestUser> {
  const supabase = adminClient();
  const email = `phase5-e2e-${role}-${RUN_ID}@${PHASE5_E2E_EMAIL_DOMAIN}`;
  const password = generatePassword();

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Failed to create ${role} fixture user: ${error?.message}`);
  }
  const authUserId = data.user.id;

  const { error: roleError } = await supabase
    .from("user_roles")
    .insert({ auth_user_id: authUserId, role });
  if (roleError) {
    throw new Error(
      `Failed to assign role ${role} to fixture user: ${roleError.message}`,
    );
  }

  if (role === "admin" || role === "super_admin") {
    const { error: profileError } = await supabase.from("admins").insert({
      auth_user_id: authUserId,
      first_name: "Phase5E2E",
      last_name: role === "super_admin" ? "SuperAdmin" : "Admin",
      email,
      role_level: role,
    });
    if (profileError) {
      throw new Error(
        `Failed to create admin profile for ${role}: ${profileError.message}`,
      );
    }
  } else if (role === "trainer") {
    const { error: profileError } = await supabase.from("trainers").insert({
      auth_user_id: authUserId,
      first_name: "Phase5E2E",
      last_name: "Trainer",
      email,
    });
    if (profileError) {
      throw new Error(`Failed to create trainer profile: ${profileError.message}`);
    }
  }
  // Student role deliberately gets no `students` row: the access-denial
  // check only needs the role to resolve, and getCurrentUserContext()
  // already handles a missing profile row gracefully (null displayName/
  // profileId), matching a real not-yet-enrolled student account.

  return { authUserId, email, password };
}

const PHASE5_E2E_ACCOUNT_PATTERN =
  /^phase5-e2e-(admin|super_admin|trainer|student)-[0-9a-z]+@phase5-e2e\.internal\.test$/;
const PHASE5_ORPHAN_LIST_PAGE_SIZE = 1000;
const PHASE5_ORPHAN_MAX_LIST_PAGES = 20;

// Deletion of the accumulated orphan backlog is opt-in only — no config in
// this repo sets this, so an ordinary `beforeAll` run only ever identifies
// and reports the backlog, never deletes it, unless a human deliberately
// sets this for that invocation.
const PHASE5_ORPHAN_DELETE_GATE_ENV_VAR = "PHASE5_E2E_ALLOW_ORPHAN_DELETE";

// Tables/columns that reference an admins/trainers profile row via its own
// primary key (NOT auth_user_id — see admins.id/trainers.id in
// supabase/migrations/20260101000004_identity_tables.sql:102-114/127-137).
// A profile referenced here is real work, not a disposable fixture leftover
// — it is left alone entirely rather than force-deleted.
const ADMIN_DEPENDENT_CHECKS: { table: string; column: string }[] = [
  { table: "payments", column: "created_by" },
  { table: "payment_refunds", column: "initiated_by" },
  { table: "student_notes", column: "created_by" },
];
const TRAINER_DEPENDENT_CHECKS: { table: string; column: string }[] = [
  { table: "assignment_submissions", column: "reviewed_by" },
  { table: "assignments", column: "trainer_id" },
  { table: "batch_trainers", column: "trainer_id" },
  { table: "class_sessions", column: "trainer_id" },
];

export type Phase5CleanupReport = {
  identified: number;
  blockedByDependents: number;
  profileDeleteFailed: number;
  attempted: number;
  succeeded: number;
  apiErrors: number;
  rejected: number;
};

/**
 * Deletes auth users from `candidateAuthUserIds`, but only after verifying
 * each one is actually safe to remove — shared by cleanupOrphanedPhase5FixtureUsers
 * and tearDownPhase5Fixtures so this safety logic exists exactly once.
 *
 * admins.auth_user_id / trainers.auth_user_id reference auth.users(id) ON
 * DELETE RESTRICT (supabase/migrations/20260101000004_identity_tables.sql:104,129)
 * — NOT cascading, despite this file's prior assumption — so a profile row
 * must be deleted before its auth user, or the auth-user delete is rejected
 * and (since the Supabase Admin API returns API errors through a resolved
 * `{ data, error }` rather than a rejection) that rejection-shaped failure
 * looks identical to success unless `error` is checked explicitly. No
 * network calls here run concurrently, and no call is raced against a
 * timeout — every step is a single sequential, error-checked operation.
 */
async function deleteAuthUsersWithProfileSafety(
  supabase: ReturnType<typeof adminClient>,
  candidateAuthUserIds: string[],
): Promise<Phase5CleanupReport> {
  if (candidateAuthUserIds.length === 0) {
    return {
      identified: 0,
      blockedByDependents: 0,
      profileDeleteFailed: 0,
      attempted: 0,
      succeeded: 0,
      apiErrors: 0,
      rejected: 0,
    };
  }

  const { data: adminRows, error: adminLookupError } = await supabase
    .from("admins")
    .select("id, auth_user_id")
    .in("auth_user_id", candidateAuthUserIds);
  if (adminLookupError) {
    throw new Error(
      `Cleanup: could not look up admin profiles: ${adminLookupError.message}`,
    );
  }
  const { data: trainerRows, error: trainerLookupError } = await supabase
    .from("trainers")
    .select("id, auth_user_id")
    .in("auth_user_id", candidateAuthUserIds);
  if (trainerLookupError) {
    throw new Error(
      `Cleanup: could not look up trainer profiles: ${trainerLookupError.message}`,
    );
  }

  const adminIdByAuthUserId = new Map(
    (adminRows ?? []).map((r) => [r.auth_user_id as string, r.id as string]),
  );
  const trainerIdByAuthUserId = new Map(
    (trainerRows ?? []).map((r) => [r.auth_user_id as string, r.id as string]),
  );
  const adminIds = [...adminIdByAuthUserId.values()];
  const trainerIds = [...trainerIdByAuthUserId.values()];

  // Precisely attribute which specific profile ids are actually referenced
  // — a single unrelated payment must not block every other candidate.
  const blockedAdminIds = new Set<string>();
  for (const { table, column } of ADMIN_DEPENDENT_CHECKS) {
    if (adminIds.length === 0) break;
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .in(column, adminIds);
    if (error) {
      throw new Error(
        `Cleanup: could not check ${table}.${column} dependents: ${error.message}`,
      );
    }
    for (const row of data ?? []) {
      const referencedId = (row as unknown as Record<string, string>)[column];
      if (referencedId) blockedAdminIds.add(referencedId);
    }
  }
  const blockedTrainerIds = new Set<string>();
  for (const { table, column } of TRAINER_DEPENDENT_CHECKS) {
    if (trainerIds.length === 0) break;
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .in(column, trainerIds);
    if (error) {
      throw new Error(
        `Cleanup: could not check ${table}.${column} dependents: ${error.message}`,
      );
    }
    for (const row of data ?? []) {
      const referencedId = (row as unknown as Record<string, string>)[column];
      if (referencedId) blockedTrainerIds.add(referencedId);
    }
  }

  const eligibleAuthUserIds = candidateAuthUserIds.filter((authUserId) => {
    const adminId = adminIdByAuthUserId.get(authUserId);
    if (adminId && blockedAdminIds.has(adminId)) return false;
    const trainerId = trainerIdByAuthUserId.get(authUserId);
    if (trainerId && blockedTrainerIds.has(trainerId)) return false;
    return true;
  });
  const blockedByDependents = candidateAuthUserIds.length - eligibleAuthUserIds.length;

  const eligibleAdminAuthUserIds = eligibleAuthUserIds.filter((id) =>
    adminIdByAuthUserId.has(id),
  );
  const eligibleTrainerAuthUserIds = eligibleAuthUserIds.filter((id) =>
    trainerIdByAuthUserId.has(id),
  );

  let adminProfileDeleteFailed = false;
  if (eligibleAdminAuthUserIds.length > 0) {
    const { error } = await supabase
      .from("admins")
      .delete()
      .in("auth_user_id", eligibleAdminAuthUserIds);
    adminProfileDeleteFailed = !!error;
  }
  let trainerProfileDeleteFailed = false;
  if (eligibleTrainerAuthUserIds.length > 0) {
    const { error } = await supabase
      .from("trainers")
      .delete()
      .in("auth_user_id", eligibleTrainerAuthUserIds);
    trainerProfileDeleteFailed = !!error;
  }

  // Never delete an auth user if its prerequisite profile deletion failed.
  const readyForAuthDelete = eligibleAuthUserIds.filter((authUserId) => {
    if (adminIdByAuthUserId.has(authUserId) && adminProfileDeleteFailed) return false;
    if (trainerIdByAuthUserId.has(authUserId) && trainerProfileDeleteFailed) return false;
    return true;
  });
  const profileDeleteFailed = eligibleAuthUserIds.length - readyForAuthDelete.length;

  let succeeded = 0;
  let apiErrors = 0;
  let rejected = 0;
  for (const authUserId of readyForAuthDelete) {
    try {
      const { error } = await supabase.auth.admin.deleteUser(authUserId);
      if (error) apiErrors += 1;
      else succeeded += 1;
    } catch {
      rejected += 1;
    }
  }

  return {
    identified: candidateAuthUserIds.length,
    blockedByDependents,
    profileDeleteFailed,
    attempted: readyForAuthDelete.length,
    succeeded,
    apiErrors,
    rejected,
  };
}

/**
 * Deletes any leftover fixture auth accounts from a previous run that
 * didn't get to its own tearDownPhase5Fixtures (e.g. a crashed run) — makes
 * the suite self-healing rather than accumulating orphaned test accounts
 * across interrupted runs. Safe to call unconditionally before every run.
 */
export async function cleanupOrphanedPhase5FixtureUsers(): Promise<void> {
  const supabase = adminClient();

  const orphanIds: string[] = [];
  let page = 1;
  let incompleteListing = false;
  while (true) {
    if (page > PHASE5_ORPHAN_MAX_LIST_PAGES) {
      incompleteListing = true;
      break;
    }
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: PHASE5_ORPHAN_LIST_PAGE_SIZE,
    });
    if (error) {
      throw new Error(
        `Cleanup: could not list auth users (page ${page}): ${error.message}`,
      );
    }
    orphanIds.push(
      ...data.users
        .filter((u) => u.email && PHASE5_E2E_ACCOUNT_PATTERN.test(u.email))
        .map((u) => u.id),
    );
    if (data.users.length < PHASE5_ORPHAN_LIST_PAGE_SIZE) break;
    page += 1;
  }

  // Safety gate: identification above is read-only, but
  // deleteAuthUsersWithProfileSafety below deletes admin/trainer profile
  // rows as part of its own sequence — so it must not be called at all
  // unless deletion is explicitly enabled, not merely have its final
  // auth-user delete skipped.
  if (process.env[PHASE5_ORPHAN_DELETE_GATE_ENV_VAR] !== "1") {
    console.warn(
      `[phase5 e2e] cleanupOrphanedPhase5FixtureUsers: identified=${orphanIds.length} ` +
        `deletionDisabled=true (set ${PHASE5_ORPHAN_DELETE_GATE_ENV_VAR}=1 to enable)` +
        (incompleteListing ? " incompleteListing=true" : ""),
    );
    return;
  }

  const report = await deleteAuthUsersWithProfileSafety(supabase, orphanIds);
  console.warn(
    `[phase5 e2e] cleanupOrphanedPhase5FixtureUsers: identified=${report.identified} ` +
      `blockedByDependents=${report.blockedByDependents} profileDeleteFailed=${report.profileDeleteFailed} ` +
      `attempted=${report.attempted} succeeded=${report.succeeded} apiErrors=${report.apiErrors} ` +
      `rejected=${report.rejected} remainingBacklog=${report.identified - report.succeeded}` +
      (incompleteListing ? " incompleteListing=true" : ""),
  );
}

export async function setUpPhase5Fixtures(): Promise<Phase5Fixtures> {
  const [admin, superAdmin, trainer, student] = await Promise.all([
    createFixtureUser("admin"),
    createFixtureUser("super_admin"),
    createFixtureUser("trainer"),
    createFixtureUser("student"),
  ]);
  return { admin, superAdmin, trainer, student };
}

export async function tearDownPhase5Fixtures(fixtures: Phase5Fixtures): Promise<void> {
  const supabase = adminClient();
  const authUserIds = Object.values(fixtures).map((u) => u.authUserId);

  // user_roles.auth_user_id does cascade, but admins/trainers do not (see
  // deleteAuthUsersWithProfileSafety above) — this run's own admin/trainer
  // profile rows must be deleted before their auth users too.
  const report = await deleteAuthUsersWithProfileSafety(supabase, authUserIds);
  if (report.succeeded < report.identified) {
    console.warn(
      `[phase5 e2e] tearDownPhase5Fixtures: identified=${report.identified} ` +
        `blockedByDependents=${report.blockedByDependents} profileDeleteFailed=${report.profileDeleteFailed} ` +
        `attempted=${report.attempted} succeeded=${report.succeeded} apiErrors=${report.apiErrors} ` +
        `rejected=${report.rejected} (non-fatal; picked up by next run's orphan sweep)`,
    );
  }
}

/**
 * Removes every synthetic student the suite's browser-driven tests created
 * (identified by the run-specific PHASE5_E2E_STUDENT_PREFIX first-name tag),
 * plus their notes, documents (DB rows and the underlying Storage objects),
 * and audit log entries — leaving the project exactly as it was found.
 */
export async function cleanupPhase5SyntheticStudents(): Promise<void> {
  const supabase = adminClient();

  const { data: students, error: studentsError } = await supabase
    .from("students")
    .select("id")
    .like("first_name", `${PHASE5_E2E_STUDENT_PREFIX}%`);
  if (studentsError) {
    throw new Error(
      `Cleanup: could not list synthetic students: ${studentsError.message}`,
    );
  }
  const studentIds = (students ?? []).map((s) => s.id);
  if (studentIds.length === 0) return;

  const { data: notes } = await supabase
    .from("student_notes")
    .select("id")
    .in("student_id", studentIds);
  const noteIds = (notes ?? []).map((n) => n.id);

  const { data: documents } = await supabase
    .from("student_documents")
    .select("id, file_path")
    .in("student_id", studentIds);
  const documentIds = (documents ?? []).map((d) => d.id);

  if (noteIds.length > 0) {
    await supabase
      .from("audit_logs")
      .delete()
      .eq("entity_type", "student_note")
      .in("entity_id", noteIds);
  }
  if (documentIds.length > 0) {
    await supabase
      .from("audit_logs")
      .delete()
      .eq("entity_type", "student_document")
      .in("entity_id", documentIds);
  }
  await supabase
    .from("audit_logs")
    .delete()
    .eq("entity_type", "student")
    .in("entity_id", studentIds);

  const filePaths = (documents ?? []).map((d) => d.file_path).filter(Boolean);
  if (filePaths.length > 0) {
    await supabase.storage.from("student-documents").remove(filePaths);
  }

  await supabase.from("student_documents").delete().in("student_id", studentIds);
  await supabase.from("student_notes").delete().in("student_id", studentIds);
  await supabase.from("students").delete().in("id", studentIds);
}

/** Post-cleanup proof, surfaced in the suite's own final assertion. */
export async function countRemainingSyntheticStudents(): Promise<number> {
  const supabase = adminClient();
  const { count, error } = await supabase
    .from("students")
    .select("id", { count: "exact", head: true })
    .like("first_name", `${PHASE5_E2E_STUDENT_PREFIX}%`);
  if (error) throw new Error(`Could not verify cleanup: ${error.message}`);
  return count ?? 0;
}
