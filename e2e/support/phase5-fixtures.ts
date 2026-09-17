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

/**
 * Deletes any leftover fixture auth accounts from a previous run that
 * didn't get to its own tearDownPhase5Fixtures (e.g. a crashed run) — makes
 * the suite self-healing rather than accumulating orphaned test accounts
 * across interrupted runs. Safe to call unconditionally before every run.
 */
export async function cleanupOrphanedPhase5FixtureUsers(): Promise<void> {
  const supabase = adminClient();
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    throw new Error(`Cleanup: could not list auth users: ${error.message}`);
  }
  const orphans = data.users.filter((u) =>
    u.email?.endsWith(`@${PHASE5_E2E_EMAIL_DOMAIN}`),
  );
  for (const orphan of orphans) {
    await supabase.auth.admin.deleteUser(orphan.id).catch(() => {});
  }
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
  const users = Object.values(fixtures);

  for (const user of users) {
    // Deleting the auth user cascades to user_roles/admins/trainers via
    // their auth_user_id foreign keys (see 20260101000004_identity_tables.sql
    // and 20260101000014_rls_policies.sql) — no separate profile-row delete
    // needed for the fixtures themselves.
    await supabase.auth.admin.deleteUser(user.authUserId).catch(() => {});
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
