import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the Phase 5 test-account cleanup defect: deleting
 * an auth user before its admins/trainers profile row failed silently
 * (admins.auth_user_id / trainers.auth_user_id are ON DELETE RESTRICT, not
 * CASCADE — supabase/migrations/20260101000004_identity_tables.sql:104,129),
 * and Supabase Admin API errors are returned through a resolved
 * `{ data, error }` rather than a rejection, so a bare `.catch(() => {})`
 * never saw the failure. This file mocks @supabase/supabase-js entirely —
 * no test here can reach a live project.
 *
 * NOT placed under e2e/ (vitest.config.ts excludes that directory so Vitest
 * never tries to run Playwright's own .spec.ts files) — this file still
 * imports and exercises the real e2e/support/phase5-fixtures.ts module.
 */

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";

const { createClient } = await import("@supabase/supabase-js");
const { cleanupOrphanedPhase5FixtureUsers, tearDownPhase5Fixtures } =
  await import("@/e2e/support/phase5-fixtures");

type AuthUser = { id: string; email: string };
type DeleteUserOutcome = "success" | "apiError" | "reject";

type FakeSupabaseConfig = {
  authUsers?: AuthUser[];
  adminRows?: { id: string; auth_user_id: string }[];
  trainerRows?: { id: string; auth_user_id: string }[];
  /** keyed "table.column" -> rows referencing a profile id via that column */
  dependentRows?: Record<string, Record<string, string>[]>;
  adminDeleteError?: { message: string } | null;
  trainerDeleteError?: { message: string } | null;
  /** keyed by auth user id */
  deleteUserOutcomes?: Record<string, DeleteUserOutcome>;
};

function createFakeSupabase(calls: string[], config: FakeSupabaseConfig) {
  const {
    authUsers = [],
    adminRows = [],
    trainerRows = [],
    dependentRows = {},
    adminDeleteError = null,
    trainerDeleteError = null,
    deleteUserOutcomes = {},
  } = config;

  function selectInBuilder(table: string) {
    return {
      select() {
        return {
          in(col: string, ids: string[]) {
            calls.push(`select:${table}.${col}`);
            if (table === "admins") {
              return Promise.resolve({
                data: adminRows.filter((r) => ids.includes(r.auth_user_id)),
                error: null,
              });
            }
            if (table === "trainers") {
              return Promise.resolve({
                data: trainerRows.filter((r) => ids.includes(r.auth_user_id)),
                error: null,
              });
            }
            const key = `${table}.${col}`;
            const rows = (dependentRows[key] ?? []).filter((r) => ids.includes(r[col]));
            return Promise.resolve({ data: rows, error: null });
          },
        };
      },
      delete() {
        return {
          in(_col: string, ids: string[]) {
            calls.push(`delete:${table}(${ids.length})`);
            if (table === "admins") return Promise.resolve({ error: adminDeleteError });
            if (table === "trainers")
              return Promise.resolve({ error: trainerDeleteError });
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  }

  return {
    auth: {
      admin: {
        listUsers: vi.fn(async ({ page }: { page: number; perPage: number }) => {
          calls.push(`listUsers:page${page}`);
          // Single page always — pagination-loop termination is exercised
          // by the "unrelated accounts are not selected" test via filtering,
          // not by multi-page behavior here.
          return page === 1
            ? { data: { users: authUsers }, error: null }
            : { data: { users: [] }, error: null };
        }),
        deleteUser: vi.fn(async (id: string) => {
          calls.push(`deleteUser:${id}`);
          const outcome = deleteUserOutcomes[id] ?? "success";
          if (outcome === "reject") throw new Error("simulated network failure");
          if (outcome === "apiError") {
            return { data: { user: null }, error: { message: "simulated delete error" } };
          }
          return { data: { user: { id } }, error: null };
        }),
      },
    },
    from: vi.fn((table: string) => selectInBuilder(table)),
  };
}

function mockCreateClientOnce(calls: string[], config: FakeSupabaseConfig) {
  const fake = createFakeSupabase(calls, config);
  vi.mocked(createClient).mockReturnValue(
    fake as unknown as ReturnType<typeof createClient>,
  );
  return fake;
}

const ADMIN_A = {
  id: "auth-admin-a",
  email: "phase5-e2e-admin-abc123@phase5-e2e.internal.test",
};
const TRAINER_A = {
  id: "auth-trainer-a",
  email: "phase5-e2e-trainer-abc124@phase5-e2e.internal.test",
};
const STUDENT_A = {
  id: "auth-student-a",
  email: "phase5-e2e-student-abc125@phase5-e2e.internal.test",
};

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

const ORPHAN_DELETE_GATE_ENV_VAR = "PHASE5_E2E_ALLOW_ORPHAN_DELETE";

describe("cleanupOrphanedPhase5FixtureUsers", () => {
  // These tests exercise the deletion logic itself, so the gate is enabled
  // for all of them — its own absent/disabled/enabled behavior is covered
  // separately below.
  const originalGateValue = process.env[ORPHAN_DELETE_GATE_ENV_VAR];
  beforeEach(() => {
    process.env[ORPHAN_DELETE_GATE_ENV_VAR] = "1";
  });
  afterEach(() => {
    if (originalGateValue === undefined) {
      delete process.env[ORPHAN_DELETE_GATE_ENV_VAR];
    } else {
      process.env[ORPHAN_DELETE_GATE_ENV_VAR] = originalGateValue;
    }
  });

  it("deletes the admin profile before the auth user", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      authUsers: [ADMIN_A],
      adminRows: [{ id: "admin-profile-1", auth_user_id: ADMIN_A.id }],
    });

    await cleanupOrphanedPhase5FixtureUsers();

    const adminDeleteIndex = calls.indexOf("delete:admins(1)");
    const authDeleteIndex = calls.indexOf(`deleteUser:${ADMIN_A.id}`);
    expect(adminDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(authDeleteIndex).toBeGreaterThan(adminDeleteIndex);
  });

  it("deletes the trainer profile before the auth user", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      authUsers: [TRAINER_A],
      trainerRows: [{ id: "trainer-profile-1", auth_user_id: TRAINER_A.id }],
    });

    await cleanupOrphanedPhase5FixtureUsers();

    const trainerDeleteIndex = calls.indexOf("delete:trainers(1)");
    const authDeleteIndex = calls.indexOf(`deleteUser:${TRAINER_A.id}`);
    expect(trainerDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(authDeleteIndex).toBeGreaterThan(trainerDeleteIndex);
  });

  it("handles student-role fixtures (no profile row) by deleting the auth user directly", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, { authUsers: [STUDENT_A] });

    await cleanupOrphanedPhase5FixtureUsers();

    expect(calls).not.toContain("delete:admins(1)");
    expect(calls).not.toContain("delete:trainers(1)");
    expect(calls).toContain(`deleteUser:${STUDENT_A.id}`);
    const report = warnSpy.mock.calls[0]?.[0] as string;
    expect(report).toContain("succeeded=1");
  });

  it("never deletes the auth user when the prerequisite profile deletion fails", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      authUsers: [ADMIN_A],
      adminRows: [{ id: "admin-profile-1", auth_user_id: ADMIN_A.id }],
      adminDeleteError: { message: "profile delete rejected" },
    });

    await cleanupOrphanedPhase5FixtureUsers();

    expect(calls).not.toContain(`deleteUser:${ADMIN_A.id}`);
    const report = warnSpy.mock.calls[0]?.[0] as string;
    expect(report).toContain("profileDeleteFailed=1");
    expect(report).toContain("attempted=0");
    expect(report).toContain("succeeded=0");
  });

  it("detects an auth-deletion API error returned through { error }", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      authUsers: [STUDENT_A],
      deleteUserOutcomes: { [STUDENT_A.id]: "apiError" },
    });

    await cleanupOrphanedPhase5FixtureUsers();

    const report = warnSpy.mock.calls[0]?.[0] as string;
    expect(report).toContain("apiErrors=1");
    expect(report).toContain("succeeded=0");
  });

  it("handles a rejected (network-failure) delete request without throwing", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      authUsers: [STUDENT_A],
      deleteUserOutcomes: { [STUDENT_A.id]: "reject" },
    });

    await expect(cleanupOrphanedPhase5FixtureUsers()).resolves.toBeUndefined();

    const report = warnSpy.mock.calls[0]?.[0] as string;
    expect(report).toContain("rejected=1");
    expect(report).toContain("succeeded=0");
  });

  it("skips an account whose admin profile has an unexpected dependent record", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      authUsers: [ADMIN_A],
      adminRows: [{ id: "admin-profile-1", auth_user_id: ADMIN_A.id }],
      dependentRows: {
        "payments.created_by": [{ created_by: "admin-profile-1" }],
      },
    });

    await cleanupOrphanedPhase5FixtureUsers();

    expect(calls).not.toContain("delete:admins(1)");
    expect(calls).not.toContain(`deleteUser:${ADMIN_A.id}`);
    const report = warnSpy.mock.calls[0]?.[0] as string;
    expect(report).toContain("blockedByDependents=1");
    expect(report).toContain("attempted=0");
  });

  it("does not select an account whose email does not match the exact fixture pattern", async () => {
    const calls: string[] = [];
    const unrelated = { id: "auth-unrelated", email: "someone@phase5-e2e.internal.test" };
    mockCreateClientOnce(calls, { authUsers: [unrelated] });

    await cleanupOrphanedPhase5FixtureUsers();

    expect(calls).not.toContain(`deleteUser:${unrelated.id}`);
    const report = warnSpy.mock.calls[0]?.[0] as string;
    expect(report).toContain("identified=0");
  });

  it("reports an accurate sanitized count across mixed outcomes, with no email or id in the report", async () => {
    const succeedsUser = {
      id: "auth-ok",
      email: "phase5-e2e-student-ok1@phase5-e2e.internal.test",
    };
    const failsUser = {
      id: "auth-fail",
      email: "phase5-e2e-student-fail1@phase5-e2e.internal.test",
    };
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      authUsers: [ADMIN_A, succeedsUser, failsUser],
      adminRows: [{ id: "admin-profile-1", auth_user_id: ADMIN_A.id }],
      dependentRows: { "payments.created_by": [{ created_by: "admin-profile-1" }] },
      deleteUserOutcomes: { [failsUser.id]: "apiError" },
    });

    await cleanupOrphanedPhase5FixtureUsers();

    const report = warnSpy.mock.calls[0]?.[0] as string;
    expect(report).toContain("identified=3");
    expect(report).toContain("blockedByDependents=1");
    expect(report).toContain("attempted=2");
    expect(report).toContain("succeeded=1");
    expect(report).toContain("apiErrors=1");
    expect(report).toContain("remainingBacklog=2");
    expect(report).not.toContain("@");
    expect(report).not.toContain(ADMIN_A.id);
    expect(report).not.toContain(succeedsUser.id);
    expect(report).not.toContain(failsUser.id);
  });
});

describe("cleanupOrphanedPhase5FixtureUsers — deletion safety gate", () => {
  const originalGateValue = process.env[ORPHAN_DELETE_GATE_ENV_VAR];
  afterEach(() => {
    if (originalGateValue === undefined) {
      delete process.env[ORPHAN_DELETE_GATE_ENV_VAR];
    } else {
      process.env[ORPHAN_DELETE_GATE_ENV_VAR] = originalGateValue;
    }
  });

  it("deletes nothing when the gate env var is absent", async () => {
    delete process.env[ORPHAN_DELETE_GATE_ENV_VAR];
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      authUsers: [ADMIN_A],
      adminRows: [{ id: "admin-profile-1", auth_user_id: ADMIN_A.id }],
    });

    await cleanupOrphanedPhase5FixtureUsers();

    expect(calls).not.toContain("delete:admins(1)");
    expect(calls).not.toContain(`deleteUser:${ADMIN_A.id}`);
    const report = warnSpy.mock.calls[0]?.[0] as string;
    expect(report).toContain("identified=1");
    expect(report).toContain("deletionDisabled=true");
  });

  it("deletes nothing when the gate env var is explicitly disabled", async () => {
    process.env[ORPHAN_DELETE_GATE_ENV_VAR] = "0";
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      authUsers: [ADMIN_A, TRAINER_A],
      adminRows: [{ id: "admin-profile-1", auth_user_id: ADMIN_A.id }],
      trainerRows: [{ id: "trainer-profile-1", auth_user_id: TRAINER_A.id }],
    });

    await cleanupOrphanedPhase5FixtureUsers();

    expect(calls).not.toContain("delete:admins(1)");
    expect(calls).not.toContain("delete:trainers(1)");
    expect(calls).not.toContain(`deleteUser:${ADMIN_A.id}`);
    expect(calls).not.toContain(`deleteUser:${TRAINER_A.id}`);
    const report = warnSpy.mock.calls[0]?.[0] as string;
    expect(report).toContain("identified=2");
    expect(report).toContain("deletionDisabled=true");
  });

  it("invokes the existing safety checks and deletion logic once the gate is explicitly enabled", async () => {
    process.env[ORPHAN_DELETE_GATE_ENV_VAR] = "1";
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      authUsers: [ADMIN_A],
      adminRows: [{ id: "admin-profile-1", auth_user_id: ADMIN_A.id }],
    });

    await cleanupOrphanedPhase5FixtureUsers();

    const adminDeleteIndex = calls.indexOf("delete:admins(1)");
    const authDeleteIndex = calls.indexOf(`deleteUser:${ADMIN_A.id}`);
    expect(adminDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(authDeleteIndex).toBeGreaterThan(adminDeleteIndex);
    const report = warnSpy.mock.calls[0]?.[0] as string;
    expect(report).toContain("succeeded=1");
    expect(report).not.toContain("deletionDisabled");
  });

  it("still never selects an unrelated account once the gate is enabled", async () => {
    process.env[ORPHAN_DELETE_GATE_ENV_VAR] = "1";
    const calls: string[] = [];
    const unrelated = {
      id: "auth-unrelated-gate",
      email: "someone@phase5-e2e.internal.test",
    };
    mockCreateClientOnce(calls, { authUsers: [unrelated] });

    await cleanupOrphanedPhase5FixtureUsers();

    expect(calls).not.toContain(`deleteUser:${unrelated.id}`);
    const report = warnSpy.mock.calls[0]?.[0] as string;
    expect(report).toContain("identified=0");
  });
});

describe("tearDownPhase5Fixtures", () => {
  const fixtures = {
    admin: { authUserId: ADMIN_A.id, email: ADMIN_A.email, password: "x" },
    superAdmin: {
      authUserId: "auth-superadmin-a",
      email: "sa@phase5-e2e.internal.test",
      password: "x",
    },
    trainer: { authUserId: TRAINER_A.id, email: TRAINER_A.email, password: "x" },
    student: { authUserId: STUDENT_A.id, email: STUDENT_A.email, password: "x" },
  };

  it("deletes admin and trainer profiles before their auth users for this run's own fixtures", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      adminRows: [
        { id: "admin-profile-1", auth_user_id: ADMIN_A.id },
        { id: "admin-profile-2", auth_user_id: "auth-superadmin-a" },
      ],
      trainerRows: [{ id: "trainer-profile-1", auth_user_id: TRAINER_A.id }],
    });

    await tearDownPhase5Fixtures(fixtures);

    const adminDeleteIndex = calls.indexOf("delete:admins(2)");
    const trainerDeleteIndex = calls.indexOf("delete:trainers(1)");
    expect(adminDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(trainerDeleteIndex).toBeGreaterThanOrEqual(0);
    for (const id of [ADMIN_A.id, "auth-superadmin-a", TRAINER_A.id, STUDENT_A.id]) {
      expect(calls.indexOf(`deleteUser:${id}`)).toBeGreaterThan(adminDeleteIndex);
      expect(calls.indexOf(`deleteUser:${id}`)).toBeGreaterThan(trainerDeleteIndex);
    }
  });

  it("does not warn when every fixture in this run is deleted successfully", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {});

    await tearDownPhase5Fixtures(fixtures);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("reports a sanitized partial-failure count when one profile delete fails", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      adminRows: [{ id: "admin-profile-1", auth_user_id: ADMIN_A.id }],
      adminDeleteError: { message: "rejected" },
    });

    await tearDownPhase5Fixtures(fixtures);

    expect(calls).not.toContain(`deleteUser:${ADMIN_A.id}`);
    const report = warnSpy.mock.calls[0]?.[0] as string;
    expect(report).toContain("identified=4");
    expect(report).toContain("profileDeleteFailed=1");
    expect(report).toContain("succeeded=3");
    expect(report).not.toContain("@");
  });
});
