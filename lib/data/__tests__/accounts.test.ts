import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/data/accounts.ts with its I/O boundaries mocked: the caller's
 * RLS-scoped client and the service-role client (database functions + the
 * Auth admin API). The database rules (fixed roles, row locks, refusals,
 * RLS) are proven in supabase/tests/phase21c_admin_identity_test.sql.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createAdminAccount,
  getStudentPortalAccess,
  provisionStudentPortalAccess,
  setAdminAccountStatus,
} from "@/lib/data/accounts";

type Result = { data?: unknown; error?: unknown };

const STUDENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const NEW_LOGIN = "bbbbbbbb-bbbb-4ccc-8ddd-000000000001";

function viewer(tables: Record<string, Result[]>) {
  const queues = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, [...v]]));
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "maybeSingle", "single", "in"]) {
        builder[m] = () => builder;
      }
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: null,
          error: null,
          ...(queues[table]?.shift() ?? {}),
        }).then(resolve);
      return builder;
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return client;
}

function service(options: {
  rpc?: Record<string, Result[]>;
  createUser?: Result;
  tables?: Record<string, Result[]>;
  appMetadata?: Record<string, unknown>;
}) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpcQueues = Object.fromEntries(
    Object.entries(options.rpc ?? {}).map(([k, v]) => [k, [...v]]),
  );
  const tableQueues = Object.fromEntries(
    Object.entries(options.tables ?? {}).map(([k, v]) => [k, [...v]]),
  );
  const auth = {
    admin: {
      createUser: vi.fn(async () => ({
        data: { user: { id: NEW_LOGIN } },
        error: null,
        ...(options.createUser ?? {}),
      })),
      deleteUser: vi.fn(async () => ({ error: null })),
      updateUserById: vi.fn(async () => ({ error: null })),
      getUserById: vi.fn(async () => ({
        data: {
          user: { email: "login@example.com", app_metadata: options.appMetadata ?? {} },
        },
        error: null,
      })),
    },
  };
  const client = {
    auth,
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({
        data: null,
        error: null,
        ...(rpcQueues[fn]?.shift() ?? {}),
      });
    },
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "maybeSingle"]) builder[m] = () => builder;
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: null,
          error: null,
          ...(tableQueues[table]?.shift() ?? {}),
        }).then(resolve);
      return builder;
    },
  };
  vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);
  return { client, auth, rpcCalls };
}

// Hosted Supabase Auth stores a random password hash for a login created
// without a password, so has_password is true even for an unused login.
const BASE_LOGIN = {
  auth_user_id: "login",
  has_password: true,
  last_sign_in_at: null,
  role: null,
  student_id: null,
  trainer_id: null,
  admin_id: null,
};

const activeStudent = {
  id: STUDENT_ID,
  student_code: "10042",
  email: "Asha.Rao@Example.com",
  status: "active",
  auth_user_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("provisionStudentPortalAccess", () => {
  it("creates a login with no password and links it with the fixed student role", async () => {
    viewer({ students: [{ data: activeStudent }] });
    const svc = service({
      rpc: {
        find_auth_account: [{ data: [] }],
        link_student_portal_account: [{ data: "linked" }],
      },
    });
    const result = await provisionStudentPortalAccess(STUDENT_ID);
    expect(result).toEqual({
      ok: true,
      data: { outcome: "linked", studentCode: "10042", email: "asha.rao@example.com" },
    });
    expect(svc.auth.admin.createUser).toHaveBeenCalledWith({
      email: "asha.rao@example.com",
      email_confirm: true,
      app_metadata: { lms_provisioned: true },
    });
    const created = svc.auth.admin.createUser.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(created[0]).not.toHaveProperty("password");
    expect(svc.rpcCalls.at(-1)).toEqual({
      fn: "link_student_portal_account",
      args: { p_student_id: STUDENT_ID, p_auth_user_id: NEW_LOGIN },
    });
  });

  it("is idempotent: an already linked student gets no new login", async () => {
    viewer({ students: [{ data: { ...activeStudent, auth_user_id: "existing" } }] });
    const svc = service({});
    const result = await provisionStudentPortalAccess(STUDENT_ID);
    expect(result.ok && result.data.outcome).toBe("already_linked");
    expect(svc.auth.admin.createUser).not.toHaveBeenCalled();
    expect(svc.rpcCalls).toEqual([]);
  });

  it("adopts a leftover login from an interrupted attempt instead of creating a duplicate", async () => {
    viewer({ students: [{ data: activeStudent }] });
    const svc = service({
      appMetadata: { lms_provisioned: true },
      rpc: {
        find_auth_account: [{ data: [{ ...BASE_LOGIN, auth_user_id: "leftover" }] }],
        link_student_portal_account: [{ data: "linked" }],
      },
    });
    const result = await provisionStudentPortalAccess(STUDENT_ID);
    expect(result.ok).toBe(true);
    expect(svc.auth.admin.createUser).not.toHaveBeenCalled();
    expect(svc.rpcCalls.at(-1)?.args.p_auth_user_id).toBe("leftover");
  });

  it.each([
    ["belongs to a trainer", { role: "trainer", trainer_id: "t1", has_password: true }],
    [
      "belongs to another student",
      { role: "student", student_id: "other", has_password: true },
    ],
    ["was not created by LMS provisioning", {}],
    ["has been signed in to", { last_sign_in_at: "2026-10-01T00:00:00Z" }],
  ])("refuses an email whose login %s and changes nothing", async (_label, login) => {
    viewer({ students: [{ data: activeStudent }] });
    const svc = service({
      appMetadata: "last_sign_in_at" in login ? { lms_provisioned: true } : {},
      rpc: {
        find_auth_account: [
          {
            data: [{ ...BASE_LOGIN, auth_user_id: "someone", ...login }],
          },
        ],
      },
    });
    const result = await provisionStudentPortalAccess(STUDENT_ID);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(
      /already belongs to another portal account/,
    );
    expect(svc.auth.admin.createUser).not.toHaveBeenCalled();
    expect(svc.rpcCalls.map((c) => c.fn)).toEqual(["find_auth_account"]);
  });

  it("deletes a login it just created when the database refuses the link", async () => {
    viewer({ students: [{ data: activeStudent }] });
    const svc = service({
      appMetadata: { lms_provisioned: true },
      rpc: {
        // The re-check finds the new login as Auth stored it: password hash
        // present, marker set, unlinked — still this request's to remove.
        find_auth_account: [
          { data: [] },
          { data: [{ ...BASE_LOGIN, auth_user_id: NEW_LOGIN }] },
        ],
        link_student_portal_account: [{ data: "student_has_other_account" }],
      },
    });
    const result = await provisionStudentPortalAccess(STUDENT_ID);
    expect(result.ok).toBe(false);
    expect(svc.auth.admin.deleteUser).toHaveBeenCalledWith(NEW_LOGIN);
  });

  it("keeps a created login that a concurrent request has linked in the meantime", async () => {
    viewer({ students: [{ data: activeStudent }] });
    const svc = service({
      rpc: {
        find_auth_account: [
          { data: [] },
          {
            data: [
              {
                ...BASE_LOGIN,
                auth_user_id: NEW_LOGIN,
                role: "student",
                student_id: "other",
              },
            ],
          },
        ],
        link_student_portal_account: [{ data: "account_in_use" }],
      },
    });
    const result = await provisionStudentPortalAccess(STUDENT_ID);
    expect(result.ok).toBe(false);
    expect(svc.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("requires an email and an active student", async () => {
    viewer({ students: [{ data: { ...activeStudent, email: null } }] });
    service({});
    expect(await provisionStudentPortalAccess(STUDENT_ID)).toEqual({
      ok: false,
      error: "Add the student's email address first — it becomes their login.",
    });
    viewer({ students: [{ data: { ...activeStudent, status: "inactive" } }] });
    expect((await provisionStudentPortalAccess(STUDENT_ID)).ok).toBe(false);
  });

  it("reports a student the caller cannot see as not found", async () => {
    viewer({ students: [{ data: null }] });
    service({});
    expect(await provisionStudentPortalAccess(STUDENT_ID)).toEqual({
      ok: false,
      error: "Student not found.",
    });
  });
});

describe("getStudentPortalAccess", () => {
  it("shows awaiting activation for a provisioned login that has a generated password hash but no sign-in", async () => {
    viewer({ students: [{ data: { ...activeStudent, auth_user_id: "login-1" } }] });
    service({
      rpc: {
        auth_account_activity: [
          {
            data: [
              { auth_user_id: "login-1", has_password: true, last_sign_in_at: null },
            ],
          },
        ],
      },
    });
    expect(await getStudentPortalAccess(STUDENT_ID)).toEqual({
      ok: true,
      data: { status: "awaiting_activation", email: "login@example.com" },
    });
  });

  it("shows active once the student has signed in", async () => {
    viewer({ students: [{ data: { ...activeStudent, auth_user_id: "login-1" } }] });
    service({
      rpc: {
        auth_account_activity: [
          {
            data: [
              {
                auth_user_id: "login-1",
                has_password: true,
                last_sign_in_at: "2026-10-14T02:00:00Z",
              },
            ],
          },
        ],
      },
    });
    expect(await getStudentPortalAccess(STUDENT_ID)).toEqual({
      ok: true,
      data: {
        status: "active",
        email: "login@example.com",
        lastSignInAt: "2026-10-14T02:00:00Z",
      },
    });
  });
});

describe("createAdminAccount", () => {
  it("creates a password-less login and links it as a plain admin", async () => {
    const svc = service({
      rpc: {
        find_auth_account: [{ data: [] }],
        link_admin_account: [{ data: [{ admin_id: "admin-1", outcome: "created" }] }],
      },
    });
    const result = await createAdminAccount({
      firstName: "Asha",
      lastName: "Rao",
      email: "Asha@Example.com",
    });
    expect(result).toEqual({
      ok: true,
      data: { outcome: "created", adminId: "admin-1", email: "asha@example.com" },
    });
    expect(svc.rpcCalls.at(-1)).toEqual({
      fn: "link_admin_account",
      args: {
        p_auth_user_id: NEW_LOGIN,
        p_first_name: "Asha",
        p_last_name: "Rao",
        p_email: "asha@example.com",
      },
    });
  });

  it("is idempotent for an existing admin and never touches other logins", async () => {
    const existing = {
      auth_user_id: "a-login",
      has_password: true,
      last_sign_in_at: null,
      role: "admin",
      student_id: null,
      trainer_id: null,
      admin_id: "admin-9",
    };
    let svc = service({ rpc: { find_auth_account: [{ data: [existing] }] } });
    const again = await createAdminAccount({
      firstName: "A",
      lastName: "B",
      email: "a@b.co",
    });
    expect(again.ok && again.data.outcome).toBe("already_admin");
    expect(svc.auth.admin.createUser).not.toHaveBeenCalled();

    svc = service({
      rpc: { find_auth_account: [{ data: [{ ...existing, role: "super_admin" }] }] },
    });
    const superLogin = await createAdminAccount({
      firstName: "A",
      lastName: "B",
      email: "a@b.co",
    });
    expect(superLogin.ok).toBe(false);
    expect(svc.rpcCalls.map((c) => c.fn)).toEqual(["find_auth_account"]);
  });

  it("removes the created login when the admin email is already used", async () => {
    const svc = service({
      rpc: {
        find_auth_account: [{ data: [] }],
        link_admin_account: [{ data: [{ admin_id: null, outcome: "email_in_use" }] }],
      },
    });
    const result = await createAdminAccount({
      firstName: "A",
      lastName: "B",
      email: "a@b.co",
    });
    expect(result).toEqual({
      ok: false,
      error: "An admin account with this email already exists.",
    });
    expect(svc.auth.admin.deleteUser).toHaveBeenCalledWith(NEW_LOGIN);
  });
});

describe("setAdminAccountStatus", () => {
  it("deactivates in the database and blocks the login's sign-in", async () => {
    const svc = service({
      rpc: {
        set_admin_account_status: [
          { data: [{ auth_user_id: "login-a", outcome: "updated" }] },
        ],
      },
      tables: { admins: [{ data: { email: "a@b.co" } }] },
    });
    expect(await setAdminAccountStatus("admin-1", "inactive")).toEqual({
      ok: true,
      data: { outcome: "updated", email: "a@b.co" },
    });
    expect(svc.auth.admin.updateUserById).toHaveBeenCalledWith("login-a", {
      ban_duration: "876000h",
    });
  });

  it("reactivation lifts the sign-in block; super admins are not manageable", async () => {
    let svc = service({
      rpc: {
        set_admin_account_status: [
          { data: [{ auth_user_id: "login-a", outcome: "updated" }] },
        ],
      },
      tables: { admins: [{ data: { email: "a@b.co" } }] },
    });
    await setAdminAccountStatus("admin-1", "active");
    expect(svc.auth.admin.updateUserById).toHaveBeenCalledWith("login-a", {
      ban_duration: "none",
    });

    svc = service({
      rpc: {
        set_admin_account_status: [
          { data: [{ auth_user_id: "login-s", outcome: "not_manageable" }] },
        ],
      },
    });
    expect(await setAdminAccountStatus("super-1", "inactive")).toEqual({
      ok: false,
      error: "Super Admin accounts cannot be changed here.",
    });
    expect(svc.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});
