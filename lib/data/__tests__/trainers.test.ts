import { describe, expect, it, vi, beforeEach } from "vitest";

// See lib/data/__tests__/students.test.ts for why `server-only` itself must
// be mocked to import the real data-layer module under Vitest.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTrainerRecord } from "@/lib/data/trainers";
import type { TrainerProfileInput } from "@/lib/validation/trainers";

function baseInput(): TrainerProfileInput {
  return {
    firstName: "Asha",
    lastName: "Rao",
    email: "asha.rao@example.com",
    phoneCountry: "IN",
    phone: "+919876543210",
    bio: null,
    specialization: [],
  };
}

function mockAdminClient(overrides: {
  createUserResult?: { data: { user: { id: string } | null }; error: unknown };
  roleInsertError?: unknown;
  trainerInsertResult?: { data: { id: string } | null; error: unknown };
}) {
  const createUser = vi.fn().mockResolvedValue(
    overrides.createUserResult ?? {
      data: { user: { id: "auth-user-1" } },
      error: null,
    },
  );
  const deleteUser = vi.fn().mockResolvedValue({ error: null });

  const userRolesInsert = vi
    .fn()
    .mockResolvedValue({ error: overrides.roleInsertError ?? null });

  const trainersInsertChain = {
    select: vi.fn().mockReturnValue({
      single: vi
        .fn()
        .mockResolvedValue(
          overrides.trainerInsertResult ?? { data: { id: "trainer-1" }, error: null },
        ),
    }),
  };

  const from = vi.fn((table: string) => {
    if (table === "user_roles") return { insert: userRolesInsert };
    if (table === "trainers")
      return { insert: vi.fn().mockReturnValue(trainersInsertChain) };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  const client = {
    auth: { admin: { createUser, deleteUser } },
    from,
  };

  vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);
  return { createUser, deleteUser, userRolesInsert, from };
}

describe("createTrainerRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the auth account, the role mapping, and the trainer profile, in that order", async () => {
    const { createUser, deleteUser, userRolesInsert, from } = mockAdminClient({});

    const result = await createTrainerRecord(baseInput());

    expect(result).toEqual({ ok: true, data: { id: "trainer-1" } });
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "asha.rao@example.com", email_confirm: true }),
    );
    // A real, unguessable password is generated and never surfaced anywhere
    // in the return value — the trainer sets their own via "Forgot password".
    const passedPassword = createUser.mock.calls[0][0].password as string;
    expect(typeof passedPassword).toBe("string");
    expect(passedPassword.length).toBeGreaterThan(10);
    expect(userRolesInsert).toHaveBeenCalledWith({
      auth_user_id: "auth-user-1",
      role: "trainer",
    });
    expect(from).toHaveBeenCalledWith("trainers");
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("surfaces a duplicate email as a specific, controlled error without creating anything", async () => {
    mockAdminClient({
      createUserResult: {
        data: { user: null },
        error: { message: "A user with this email address has already been registered" },
      },
    });

    const result = await createTrainerRecord(baseInput());

    expect(result).toEqual({
      ok: false,
      error: "This email is already registered to another account.",
    });
  });

  it("rolls back (deletes) the auth account if assigning the trainer role fails", async () => {
    const { deleteUser } = mockAdminClient({
      roleInsertError: new Error("role insert failed"),
    });

    const result = await createTrainerRecord(baseInput());

    expect(result.ok).toBe(false);
    expect(deleteUser).toHaveBeenCalledWith("auth-user-1");
  });

  it("rolls back (deletes) the auth account if creating the trainer profile row fails, never leaving an orphaned login account", async () => {
    const { deleteUser } = mockAdminClient({
      trainerInsertResult: { data: null, error: new Error("insert failed") },
    });

    const result = await createTrainerRecord(baseInput());

    expect(result.ok).toBe(false);
    expect(deleteUser).toHaveBeenCalledWith("auth-user-1");
  });

  it("never calls deleteUser when auth account creation itself is what failed (nothing to roll back)", async () => {
    const { deleteUser } = mockAdminClient({
      createUserResult: { data: { user: null }, error: new Error("network error") },
    });

    await createTrainerRecord(baseInput());

    expect(deleteUser).not.toHaveBeenCalled();
  });
});
