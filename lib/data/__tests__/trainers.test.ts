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
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createTrainerRecord, findDuplicateTrainers } from "@/lib/data/trainers";
import type { TrainerProfileInput } from "@/lib/validation/trainers";

type TrainerRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
};

// Real regression coverage for the bug this round fixes: a genuine
// duplicate phone (`+16475293460` created twice) was NOT flagged. The root
// cause traced to a fragile hand-built `.or()` filter string combining an
// admin-entered email with a phone digit pattern — supabase-js's own docs
// for `.or()` warn the string "needs to follow PostgREST syntax... you also
// need to make sure it's properly sanitized", unlike `.ilike()`, which has
// no such caveat. This mocks only the true I/O boundary
// (createSupabaseServerClient) so the REAL two-query findDuplicateTrainers
// runs end-to-end, proving the fix actually works rather than just the
// pure domain matcher in isolation.
function mockServerClientForDuplicates(rowsByTable: TrainerRow[]) {
  const from = vi.fn((table: string) => {
    if (table !== "trainers") throw new Error(`Unexpected table: ${table}`);
    return {
      select: vi.fn().mockReturnValue({
        ilike: vi.fn((column: "email" | "phone", pattern: string) => ({
          limit: vi.fn().mockResolvedValue({
            data: rowsByTable.filter((row) => {
              const value = row[column];
              if (!value) return false;
              const needle = pattern.replace(/%/g, "").toLowerCase();
              return value.toLowerCase().includes(needle);
            }),
            error: null,
          }),
        })),
      }),
    };
  });

  const client = { from };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return { from };
}

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

describe("findDuplicateTrainers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flags the exact reported miss: a canonical phone entered as bare digits with a country matches the same phone stored in E.164", async () => {
    mockServerClientForDuplicates([
      {
        id: "existing-1",
        first_name: "Existing",
        last_name: "Trainer",
        email: "someone.else@example.com",
        phone: "+16475293460",
      },
    ]);

    // The candidate as it arrives after validation/normalization: the form
    // was submitted with "6475293460" and country CA, which
    // trainerProfileSchema normalizes to canonical E.164 before this ever
    // runs — this is what a fixed submission of the exact reported scenario
    // looks like by the time it reaches the data layer.
    const result = await findDuplicateTrainers({
      email: "new.trainer@example.com",
      phone: "+16475293460",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].candidate.id).toBe("existing-1");
    expect(result.data[0].reasons).toEqual(["phone"]);
  });

  it("distinguishes an email-only match from a phone-only match across two different candidates", async () => {
    mockServerClientForDuplicates([
      {
        id: "email-match",
        first_name: "Email",
        last_name: "Match",
        email: "new.trainer@example.com",
        phone: "+911234567890",
      },
      {
        id: "phone-match",
        first_name: "Phone",
        last_name: "Match",
        email: "unrelated@example.com",
        phone: "+16475293460",
      },
    ]);

    const result = await findDuplicateTrainers({
      email: "new.trainer@example.com",
      phone: "+16475293460",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = Object.fromEntries(result.data.map((m) => [m.candidate.id, m.reasons]));
    expect(byId["email-match"]).toEqual(["email"]);
    expect(byId["phone-match"]).toEqual(["phone"]);
  });

  it("flags a single candidate that matches on both email and phone with both reasons", async () => {
    mockServerClientForDuplicates([
      {
        id: "existing-1",
        first_name: "Existing",
        last_name: "Trainer",
        email: "new.trainer@example.com",
        phone: "+16475293460",
      },
    ]);

    const result = await findDuplicateTrainers({
      email: "new.trainer@example.com",
      phone: "+16475293460",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].reasons.sort()).toEqual(["email", "phone"]);
  });

  it("returns no matches when neither email nor phone is used by any existing trainer", async () => {
    mockServerClientForDuplicates([
      {
        id: "existing-1",
        first_name: "Existing",
        last_name: "Trainer",
        email: "someone.else@example.com",
        phone: "+911234567890",
      },
    ]);

    const result = await findDuplicateTrainers({
      email: "new.trainer@example.com",
      phone: "+16475293460",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
  });

  it("does not run a phone lookup query at all when no phone is submitted", async () => {
    const { from } = mockServerClientForDuplicates([]);

    const result = await findDuplicateTrainers({
      email: "new.trainer@example.com",
      phone: null,
    });

    expect(result.ok).toBe(true);
    // Only the "trainers" table is ever queried in this test, but we can
    // still confirm no second select() chain was built for phone by
    // checking the call count against the single expected email query.
    expect(from).toHaveBeenCalledTimes(1);
  });
});
