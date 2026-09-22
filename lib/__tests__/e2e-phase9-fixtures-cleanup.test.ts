import { describe, expect, it, vi } from "vitest";

/**
 * Mocked safety coverage for e2e/support/phase9-fixtures.ts's delete-if-safe
 * helpers (deletePhase9LoginIdentity, deletePhase9SyntheticStudentIfSafe,
 * deletePhase9SyntheticEnrollmentIfSafe) — the module the Phase 9 live E2E
 * suite (e2e/phase9-enrollment-management.spec.ts) uses to tear down its own
 * synthetic records. This file mocks @supabase/supabase-js entirely: no test
 * here can reach a live project, create/delete a real record, or touch the
 * historical Phase 5 backlog.
 *
 * Same rationale as lib/__tests__/e2e-phase5-fixtures-cleanup.test.ts (NOT
 * placed under e2e/ — vitest.config.ts excludes that directory so Vitest
 * never tries to run Playwright's own .spec.ts files), and same overall
 * shape, but exercising Phase 9's own, deliberately simpler design: no
 * pagination/backlog sweep, every helper here only ever operates on one
 * caller-supplied id (or a short list of dependent tables to check for that
 * one id) at a time.
 */

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";

const { createClient } = await import("@supabase/supabase-js");
const {
  createPhase9LoginIdentity,
  deletePhase9LoginIdentity,
  deletePhase9SyntheticStudentIfSafe,
  deletePhase9SyntheticEnrollmentIfSafe,
  Phase9PartialLoginIdentityError,
} = await import("@/e2e/support/phase9-fixtures");

type Row = Record<string, unknown>;
type ApiError = { message: string } | null;
type QueryOutcome = { data: Row[] | null; error: ApiError } | "reject";
type MutateOutcome = { error: ApiError } | "reject";

type CreateUserOutcome = { userId: string; error: ApiError } | "reject";

const MOCK_CREATED_AUTH_USER_ID = "generated-auth-user-1";

type FakeConfig = {
  /** keyed by table name — controls what a `.select(...)` chain resolves to */
  selectOutcomes?: Partial<Record<string, QueryOutcome>>;
  /** keyed by table name — controls what a `.delete(...)` chain resolves to */
  deleteOutcomes?: Partial<Record<string, MutateOutcome>>;
  /** keyed by table name — controls what an `.insert(...)` chain resolves to */
  insertOutcomes?: Partial<Record<string, MutateOutcome>>;
  deleteUserOutcome?: MutateOutcome;
  /** controls auth.admin.createUser — defaults to a successful, fixed-id creation */
  createUserOutcome?: CreateUserOutcome;
};

type TableBuilder = {
  select(cols?: string): TableBuilder;
  delete(): TableBuilder;
  insert(row: Row): TableBuilder;
  eq(col: string, val: unknown): TableBuilder;
  limit(n: number): TableBuilder;
  then<TResult1, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: Row[] | null;
          error: ApiError;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
};

function makeTableBuilder(
  table: string,
  calls: string[],
  config: FakeConfig,
): TableBuilder {
  let mode: "select" | "delete" | "insert" = "select";
  const builder: TableBuilder = {
    select() {
      mode = "select";
      calls.push(`select:${table}`);
      return builder;
    },
    delete() {
      mode = "delete";
      calls.push(`delete:${table}`);
      return builder;
    },
    insert() {
      mode = "insert";
      calls.push(`insert:${table}`);
      return builder;
    },
    eq(col) {
      calls.push(`eq:${table}.${col}`);
      return builder;
    },
    limit() {
      return builder;
    },
    then(onfulfilled, onrejected) {
      let resolved: { data: Row[] | null; error: ApiError };
      if (mode === "select") {
        const outcome: QueryOutcome = config.selectOutcomes?.[table] ?? {
          data: [],
          error: null,
        };
        if (outcome === "reject") {
          return Promise.reject(new Error(`simulated network failure (${table})`)).then(
            onfulfilled,
            onrejected,
          );
        }
        resolved = outcome;
      } else {
        const outcomeMap =
          mode === "delete" ? config.deleteOutcomes : config.insertOutcomes;
        const outcome: MutateOutcome = outcomeMap?.[table] ?? { error: null };
        if (outcome === "reject") {
          return Promise.reject(new Error(`simulated network failure (${table})`)).then(
            onfulfilled,
            onrejected,
          );
        }
        resolved = { data: null, error: outcome.error };
      }
      return Promise.resolve(resolved).then(onfulfilled, onrejected);
    },
  };
  return builder;
}

function createFakeSupabase(calls: string[], config: FakeConfig) {
  return {
    auth: {
      admin: {
        deleteUser: vi.fn(async (id: string) => {
          calls.push(`deleteUser:${id}`);
          const outcome = config.deleteUserOutcome ?? { error: null };
          if (outcome === "reject") {
            throw new Error("simulated network failure (deleteUser)");
          }
          return {
            data: outcome.error ? { user: null } : { user: { id } },
            error: outcome.error,
          };
        }),
        createUser: vi.fn(async (attrs: { email: string }) => {
          calls.push(`createUser:${attrs.email}`);
          const outcome = config.createUserOutcome ?? {
            userId: MOCK_CREATED_AUTH_USER_ID,
            error: null,
          };
          if (outcome === "reject") {
            throw new Error("simulated network failure (createUser)");
          }
          if (outcome.error) {
            return { data: { user: null }, error: outcome.error };
          }
          return { data: { user: { id: outcome.userId } }, error: null };
        }),
      },
    },
    from: vi.fn((table: string) => makeTableBuilder(table, calls, config)),
  };
}

function mockCreateClientOnce(calls: string[], config: FakeConfig) {
  const fake = createFakeSupabase(calls, config);
  vi.mocked(createClient).mockReturnValue(
    fake as unknown as ReturnType<typeof createClient>,
  );
  return fake;
}

const ADMIN_IDENTITY = {
  authUserId: "auth-admin-1",
  email: "phase9-e2e-admin-x@phase9-e2e.internal.test",
  password: "x",
  role: "admin" as const,
  hasAdminProfile: true,
  hasTrainerProfile: false,
};
const TRAINER_IDENTITY = {
  authUserId: "auth-trainer-1",
  email: "phase9-e2e-trainer-x@phase9-e2e.internal.test",
  password: "x",
  role: "trainer" as const,
  hasAdminProfile: false,
  hasTrainerProfile: true,
};
const STUDENT_LOGIN_IDENTITY = {
  authUserId: "auth-student-1",
  email: "phase9-e2e-student-x@phase9-e2e.internal.test",
  password: "x",
  role: "student" as const,
  hasAdminProfile: false,
  hasTrainerProfile: false,
};

describe("createPhase9LoginIdentity", () => {
  it("creates a fully-formed Admin identity when every step succeeds", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {});

    const identity = await createPhase9LoginIdentity("admin", "list");

    expect(identity).toEqual({
      authUserId: MOCK_CREATED_AUTH_USER_ID,
      email: expect.any(String),
      password: expect.any(String),
      role: "admin",
      hasAdminProfile: true,
      hasTrainerProfile: false,
    });
    expect(calls).toContain("insert:user_roles");
    expect(calls).toContain("insert:admins");
  });

  it("creates a fully-formed Trainer identity when every step succeeds", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {});

    const identity = await createPhase9LoginIdentity("trainer", "authz-trainer");

    expect(identity.hasTrainerProfile).toBe(true);
    expect(identity.hasAdminProfile).toBe(false);
    expect(calls).toContain("insert:trainers");
    expect(calls).not.toContain("insert:admins");
  });

  it("creates a Student identity with no profile row attempted", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {});

    const identity = await createPhase9LoginIdentity("student", "authz-student");

    expect(identity).toEqual({
      authUserId: MOCK_CREATED_AUTH_USER_ID,
      email: expect.any(String),
      password: expect.any(String),
      role: "student",
      hasAdminProfile: false,
      hasTrainerProfile: false,
    });
    expect(calls).not.toContain("insert:admins");
    expect(calls).not.toContain("insert:trainers");
  });

  it("throws a plain Error, never a partial-identity error, when auth.admin.createUser itself fails — nothing exists to recover", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      createUserOutcome: { userId: "", error: { message: "createUser failed" } },
    });

    await expect(createPhase9LoginIdentity("admin", "list")).rejects.not.toBeInstanceOf(
      Phase9PartialLoginIdentityError,
    );
    expect(calls).not.toContain("insert:user_roles");
  });

  it("throws a plain Error, not a thrown-away rejection, when the createUser request itself is rejected (network failure)", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, { createUserOutcome: "reject" });

    await expect(createPhase9LoginIdentity("admin", "list")).rejects.not.toBeInstanceOf(
      Phase9PartialLoginIdentityError,
    );
    expect(calls).not.toContain("insert:user_roles");
  });

  it("throws Phase9PartialLoginIdentityError carrying the created auth user id when user_roles assignment fails", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      insertOutcomes: { user_roles: { error: { message: "role insert failed" } } },
    });

    let caught: unknown;
    try {
      await createPhase9LoginIdentity("admin", "list");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Phase9PartialLoginIdentityError);
    const partial = (caught as InstanceType<typeof Phase9PartialLoginIdentityError>)
      .partial;
    expect(partial.authUserId).toBe(MOCK_CREATED_AUTH_USER_ID);
    expect(partial.hasAdminProfile).toBe(false);
    expect(partial.hasTrainerProfile).toBe(false);
  });

  it("throws Phase9PartialLoginIdentityError with hasAdminProfile:false when the admin profile insert fails after user_roles succeeds", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      insertOutcomes: { admins: { error: { message: "admin profile insert failed" } } },
    });

    let caught: unknown;
    try {
      await createPhase9LoginIdentity("admin", "list");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Phase9PartialLoginIdentityError);
    const partial = (caught as InstanceType<typeof Phase9PartialLoginIdentityError>)
      .partial;
    expect(partial.authUserId).toBe(MOCK_CREATED_AUTH_USER_ID);
    expect(partial.hasAdminProfile).toBe(false);
    void calls;
  });

  it("throws Phase9PartialLoginIdentityError with hasTrainerProfile:false when the trainer profile insert fails after user_roles succeeds", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      insertOutcomes: {
        trainers: { error: { message: "trainer profile insert failed" } },
      },
    });

    let caught: unknown;
    try {
      await createPhase9LoginIdentity("trainer", "authz-trainer");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Phase9PartialLoginIdentityError);
    const partial = (caught as InstanceType<typeof Phase9PartialLoginIdentityError>)
      .partial;
    expect(partial.authUserId).toBe(MOCK_CREATED_AUTH_USER_ID);
    expect(partial.hasTrainerProfile).toBe(false);
    void calls;
  });

  it("reports the partial identity (not a thrown-away plain Error) when the user_roles insert request is rejected (network failure)", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, { insertOutcomes: { user_roles: "reject" } });

    let caught: unknown;
    try {
      await createPhase9LoginIdentity("admin", "list");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Phase9PartialLoginIdentityError);
    const partial = (caught as InstanceType<typeof Phase9PartialLoginIdentityError>)
      .partial;
    expect(partial.authUserId).toBe(MOCK_CREATED_AUTH_USER_ID);
    void calls;
  });
});

describe("deletePhase9LoginIdentity", () => {
  it("deletes the admin profile before the auth user", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {});

    const result = await deletePhase9LoginIdentity(ADMIN_IDENTITY);

    expect(result).toEqual({ ok: true });
    const adminDeleteIndex = calls.indexOf("delete:admins");
    const authDeleteIndex = calls.indexOf(`deleteUser:${ADMIN_IDENTITY.authUserId}`);
    expect(adminDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(authDeleteIndex).toBeGreaterThan(adminDeleteIndex);
  });

  it("deletes the trainer profile before the auth user", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {});

    const result = await deletePhase9LoginIdentity(TRAINER_IDENTITY);

    expect(result).toEqual({ ok: true });
    const trainerDeleteIndex = calls.indexOf("delete:trainers");
    const authDeleteIndex = calls.indexOf(`deleteUser:${TRAINER_IDENTITY.authUserId}`);
    expect(trainerDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(authDeleteIndex).toBeGreaterThan(trainerDeleteIndex);
  });

  it("deletes the auth user directly for a Student identity (no profile row)", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {});

    const result = await deletePhase9LoginIdentity(STUDENT_LOGIN_IDENTITY);

    expect(result).toEqual({ ok: true });
    expect(calls).not.toContain("delete:admins");
    expect(calls).not.toContain("delete:trainers");
    expect(calls).toContain(`deleteUser:${STUDENT_LOGIN_IDENTITY.authUserId}`);
  });

  it("deletes only the auth user for a partial (profile-less) Admin identity — the exact shape a recovered Phase9PartialLoginIdentityError.partial has when the admins insert never succeeded", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {});
    const partialAdmin = {
      authUserId: "auth-admin-partial",
      email: "phase9-e2e-admin-partial@phase9-e2e.internal.test",
      password: "x",
      role: "admin" as const,
      hasAdminProfile: false,
      hasTrainerProfile: false,
    };

    const result = await deletePhase9LoginIdentity(partialAdmin);

    expect(result).toEqual({ ok: true });
    expect(calls).not.toContain("delete:admins");
    expect(calls).toContain(`deleteUser:${partialAdmin.authUserId}`);
  });

  it("never deletes the auth user when the admin profile delete fails", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      deleteOutcomes: { admins: { error: { message: "profile delete rejected" } } },
    });

    const result = await deletePhase9LoginIdentity(ADMIN_IDENTITY);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("admin profile");
    expect(calls).not.toContain(`deleteUser:${ADMIN_IDENTITY.authUserId}`);
  });

  it("never deletes the auth user when the trainer profile delete fails", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      deleteOutcomes: { trainers: { error: { message: "profile delete rejected" } } },
    });

    const result = await deletePhase9LoginIdentity(TRAINER_IDENTITY);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("trainer profile");
    expect(calls).not.toContain(`deleteUser:${TRAINER_IDENTITY.authUserId}`);
  });

  it("reports ok:false (not a thrown rejection) when a profile delete request is rejected (network failure)", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, { deleteOutcomes: { admins: "reject" } });

    await expect(deletePhase9LoginIdentity(ADMIN_IDENTITY)).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(calls).not.toContain(`deleteUser:${ADMIN_IDENTITY.authUserId}`);
  });

  it("detects an auth-user deletion API error returned through { error } — a resolved promise never means success", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      deleteUserOutcome: { error: { message: "simulated delete error" } },
    });

    const result = await deletePhase9LoginIdentity(STUDENT_LOGIN_IDENTITY);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("auth user");
  });

  it("reports ok:false (not a thrown rejection) when the auth-user delete request is rejected (network failure)", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, { deleteUserOutcome: "reject" });

    await expect(deletePhase9LoginIdentity(STUDENT_LOGIN_IDENTITY)).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
    void calls;
  });

  it("never issues an explicit user_roles delete — deleting the auth user is relied on to cascade it", async () => {
    // Verified directly against the migration, not assumed:
    // user_roles.auth_user_id references auth.users(id) ON DELETE CASCADE
    // (supabase/migrations/20260101000004_identity_tables.sql:6) — unlike
    // admins/trainers.auth_user_id, which are ON DELETE RESTRICT and DO
    // need the explicit profile-delete-before-auth-delete ordering already
    // covered above. A future accidental "helpfully" added explicit
    // user_roles delete would be redundant at best; this pins the current,
    // correct, cascade-only behavior for every role shape.
    for (const identity of [ADMIN_IDENTITY, TRAINER_IDENTITY, STUDENT_LOGIN_IDENTITY]) {
      const calls: string[] = [];
      mockCreateClientOnce(calls, {});

      const result = await deletePhase9LoginIdentity(identity);

      expect(result).toEqual({ ok: true });
      expect(calls).not.toContain("delete:user_roles");
      expect(calls).not.toContain("select:user_roles");
    }
  });
});

describe("deletePhase9SyntheticStudentIfSafe", () => {
  const STUDENT_ID = "student-1";

  it("deletes the student when no dependent table has any matching row", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {});

    const result = await deletePhase9SyntheticStudentIfSafe(STUDENT_ID);

    expect(result).toEqual({ ok: true });
    expect(calls).toContain("delete:students");
  });

  it("skips deletion when the student still has an enrollment", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      selectOutcomes: { enrollments: { data: [{ id: "e1" }], error: null } },
    });

    const result = await deletePhase9SyntheticStudentIfSafe(STUDENT_ID);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("enrollment");
    expect(calls).not.toContain("delete:students");
  });

  it("skips deletion when the student still has a note", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      selectOutcomes: { student_notes: { data: [{ id: "n1" }], error: null } },
    });

    const result = await deletePhase9SyntheticStudentIfSafe(STUDENT_ID);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("note");
    expect(calls).not.toContain("delete:students");
  });

  it("skips deletion when the student still has a document", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      selectOutcomes: { student_documents: { data: [{ id: "d1" }], error: null } },
    });

    const result = await deletePhase9SyntheticStudentIfSafe(STUDENT_ID);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("document");
    expect(calls).not.toContain("delete:students");
  });

  it("returns ok:false, quoting the real Supabase error, when a dependent check itself fails", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      selectOutcomes: { enrollments: { data: null, error: { message: "boom" } } },
    });

    const result = await deletePhase9SyntheticStudentIfSafe(STUDENT_ID);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("boom");
    expect(calls).not.toContain("delete:students");
  });

  it("returns ok:false (not a thrown rejection) when a dependent check request is rejected (network failure)", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, { selectOutcomes: { enrollments: "reject" } });

    await expect(deletePhase9SyntheticStudentIfSafe(STUDENT_ID)).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(calls).not.toContain("delete:students");
  });

  it("returns ok:false when the final student delete itself fails", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      deleteOutcomes: { students: { error: { message: "fk violation" } } },
    });

    const result = await deletePhase9SyntheticStudentIfSafe(STUDENT_ID);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("fk violation");
  });

  it("scopes every check and delete to exactly this student id, never an unrelated one", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {});

    await deletePhase9SyntheticStudentIfSafe(STUDENT_ID);

    // Every dependent check and the final delete key off student_id/id —
    // this fake records the column name only (not the value), so this
    // asserts the *shape* of scoping; the real client call sites
    // (e2e/support/phase9-fixtures.ts) pass STUDENT_ID as the value.
    expect(calls).toContain("eq:enrollments.student_id");
    expect(calls).toContain("eq:student_notes.student_id");
    expect(calls).toContain("eq:student_documents.student_id");
    expect(calls).toContain("eq:students.id");
  });
});

describe("deletePhase9SyntheticEnrollmentIfSafe", () => {
  const ENROLLMENT_ID = "enrollment-1";
  const DEPENDENT_TABLES = [
    "payment_plans",
    "payments",
    "attendance",
    "assignment_submissions",
    "certificates",
  ];

  it("deletes the enrollment once all five FK-dependent tables are confirmed empty", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {});

    const result = await deletePhase9SyntheticEnrollmentIfSafe(ENROLLMENT_ID);

    expect(result).toEqual({ ok: true });
    for (const table of DEPENDENT_TABLES) {
      expect(calls).toContain(`select:${table}`);
    }
    expect(calls).toContain("delete:enrollments");
    expect(calls.indexOf("delete:enrollments")).toBeGreaterThan(
      Math.max(...DEPENDENT_TABLES.map((t) => calls.indexOf(`select:${t}`))),
    );
  });

  it.each(DEPENDENT_TABLES)(
    "skips deletion when %s still has a row referencing this enrollment",
    async (table) => {
      const calls: string[] = [];
      mockCreateClientOnce(calls, {
        selectOutcomes: { [table]: { data: [{ id: "r1" }], error: null } },
      });

      const result = await deletePhase9SyntheticEnrollmentIfSafe(ENROLLMENT_ID);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain(table);
      expect(calls).not.toContain("delete:enrollments");
    },
  );

  it("treats a CASCADE-marked dependent table (payment_plans) as blocking too, never relying on the DB to cascade silently", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      selectOutcomes: { payment_plans: { data: [{ id: "pp1" }], error: null } },
    });

    const result = await deletePhase9SyntheticEnrollmentIfSafe(ENROLLMENT_ID);

    expect(result.ok).toBe(false);
    expect(calls).not.toContain("delete:enrollments");
  });

  it("returns ok:false (not a thrown rejection) when a dependent check request is rejected (network failure)", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, { selectOutcomes: { payments: "reject" } });

    await expect(deletePhase9SyntheticEnrollmentIfSafe(ENROLLMENT_ID)).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(calls).not.toContain("delete:enrollments");
  });

  it("returns ok:false when the final enrollment delete itself fails", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {
      deleteOutcomes: { enrollments: { error: { message: "unexpected fk violation" } } },
    });

    const result = await deletePhase9SyntheticEnrollmentIfSafe(ENROLLMENT_ID);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unexpected fk violation");
  });

  it("never deletes an unrelated table — only this enrollment's own audit_logs rows and the enrollment row itself", async () => {
    const calls: string[] = [];
    mockCreateClientOnce(calls, {});

    await deletePhase9SyntheticEnrollmentIfSafe(ENROLLMENT_ID);

    const deleteCalls = calls.filter((c) => c.startsWith("delete:"));
    expect(deleteCalls.sort()).toEqual(["delete:audit_logs", "delete:enrollments"]);
  });
});
