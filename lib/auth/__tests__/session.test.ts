import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/auth/session";

function client(role: string, profile: Record<string, unknown> | null) {
  const selects: Array<{ table: string; columns: string }> = [];
  const c = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "auth-1", email: "a@b.co" } },
        error: null,
      })),
    },
    from(table: string) {
      const builder: Record<string, unknown> = {};
      builder.select = (columns: string) => {
        selects.push({ table, columns });
        return builder;
      };
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({
        data: table === "user_roles" ? { role } : profile,
        error: null,
      });
      return builder;
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(c as never);
  return selects;
}

beforeEach(() => vi.clearAllMocks());

describe("getCurrentUserContext — Phase 21C deactivated admins", () => {
  it("treats an inactive admin as not authenticated", async () => {
    client("admin", { id: "adm-1", first_name: "A", last_name: "B", status: "inactive" });
    expect(await getCurrentUserContext()).toBeNull();
  });

  it("keeps an active admin and reads status only for admins", async () => {
    const selects = client("super_admin", {
      id: "adm-1",
      first_name: "A",
      last_name: "B",
      status: "active",
    });
    expect(await getCurrentUserContext()).toMatchObject({
      role: "super_admin",
      profileId: "adm-1",
      displayName: "A B",
    });
    expect(selects.find((s) => s.table === "admins")?.columns).toContain("status");
  });

  it("keeps a bootstrap admin role without an admins profile row", async () => {
    client("super_admin", null);
    expect(await getCurrentUserContext()).toMatchObject({
      role: "super_admin",
      profileId: null,
    });
  });

  it("does not ask students for a status column", async () => {
    const selects = client("student", { id: "stu-1", first_name: "S", last_name: "T" });
    expect(await getCurrentUserContext()).toMatchObject({
      role: "student",
      profileId: "stu-1",
    });
    expect(selects.find((s) => s.table === "students")?.columns).toBe(
      "id, first_name, last_name",
    );
  });
});
