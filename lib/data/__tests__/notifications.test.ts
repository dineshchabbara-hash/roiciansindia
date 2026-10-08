import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mocks only createSupabaseServerClient (the true I/O boundary) with a
 * chainable query builder that records every call, so the real
 * lib/data/notifications.ts query construction and control flow run.
 */

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getUnreadNotificationCount,
  markNotificationReadRecord,
  resolveNotificationRecipient,
  searchNotificationRecipients,
  sendNotificationRecord,
} from "@/lib/data/notifications";

type Call = { method: string; args: unknown[] };
type QueryResult = { data?: unknown; error?: unknown; count?: number | null };

function makeClient(results: QueryResult[]) {
  const queries: Array<{ table: string; calls: Call[] }> = [];
  const client = {
    from(table: string) {
      const record = { table, calls: [] as Call[] };
      queries.push(record);
      const result = results.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const method of [
        "select",
        "insert",
        "update",
        "eq",
        "not",
        "or",
        "in",
        "order",
        "limit",
        "single",
        "maybeSingle",
      ]) {
        builder[method] = (...args: unknown[]) => {
          record.calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (value: QueryResult) => unknown) =>
        resolve({ error: null, ...result });
      return builder;
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return queries;
}

function callsOf(query: { calls: Call[] }, method: string) {
  return query.calls.filter((c) => c.method === method).map((c) => c.args);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sendNotificationRecord", () => {
  it("inserts an unread in_app admin_message with the caller as sender", async () => {
    const queries = makeClient([{ data: { id: "n-1" } }]);
    const result = await sendNotificationRecord({
      senderAuthUserId: "admin-auth",
      recipientAuthUserId: "student-auth",
      title: "Hello",
      body: "World",
    });
    expect(result).toEqual({ ok: true, data: { id: "n-1" } });
    expect(queries[0].table).toBe("notifications");
    expect(callsOf(queries[0], "insert")[0][0]).toEqual({
      recipient_auth_user_id: "student-auth",
      created_by_auth_user_id: "admin-auth",
      type: "admin_message",
      title: "Hello",
      body: "World",
      channel: "in_app",
      status: "unread",
    });
  });

  it("returns a generic error when the insert is rejected", async () => {
    makeClient([
      { data: null, error: { message: "new row violates row-level security policy" } },
    ]);
    const result = await sendNotificationRecord({
      senderAuthUserId: "a",
      recipientAuthUserId: "b",
      title: "t",
      body: "b",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toMatch(/row-level/);
  });
});

describe("resolveNotificationRecipient", () => {
  const ref = {
    kind: "student" as const,
    profileId: "11111111-2222-4333-8444-555555555555",
  };

  it("returns the profile's own auth user id", async () => {
    const queries = makeClient([
      {
        data: {
          id: ref.profileId,
          auth_user_id: "student-auth",
          first_name: "Asha",
          last_name: "Rao",
          email: "a@x.test",
        },
      },
    ]);
    const result = await resolveNotificationRecipient(ref);
    expect(result).toEqual({
      ok: true,
      data: { authUserId: "student-auth", name: "Asha Rao", kind: "student" },
    });
    expect(queries[0].table).toBe("students");
    expect(callsOf(queries[0], "eq")[0]).toEqual(["id", ref.profileId]);
  });

  it("looks trainers up in the trainers table", async () => {
    const queries = makeClient([
      {
        data: {
          id: ref.profileId,
          auth_user_id: "t-auth",
          first_name: "T",
          last_name: "R",
          email: null,
        },
      },
    ]);
    await resolveNotificationRecipient({ ...ref, kind: "trainer" });
    expect(queries[0].table).toBe("trainers");
  });

  it("rejects a missing profile and a profile without a portal login", async () => {
    makeClient([{ data: null }]);
    expect((await resolveNotificationRecipient(ref)).ok).toBe(false);
    makeClient([
      {
        data: {
          id: ref.profileId,
          auth_user_id: null,
          first_name: "A",
          last_name: "B",
          email: null,
        },
      },
    ]);
    const noLogin = await resolveNotificationRecipient(ref);
    expect(noLogin.ok).toBe(false);
    if (!noLogin.ok) expect(noLogin.error).toMatch(/portal login/);
  });
});

describe("markNotificationReadRecord", () => {
  const input = { notificationId: "n-1", recipientAuthUserId: "student-auth" };

  it("updates only the caller's own unread row", async () => {
    const queries = makeClient([{ data: [{ id: "n-1" }] }]);
    const result = await markNotificationReadRecord(input);
    expect(result).toEqual({ ok: true, data: null });
    const update = callsOf(queries[0], "update")[0][0] as Record<string, unknown>;
    expect(update.status).toBe("read");
    expect(typeof update.read_at).toBe("string");
    expect(callsOf(queries[0], "eq")).toEqual([
      ["id", "n-1"],
      ["recipient_auth_user_id", "student-auth"],
      ["status", "unread"],
    ]);
    expect(queries).toHaveLength(1);
  });

  it("is idempotent for an already-read own notification", async () => {
    makeClient([{ data: [] }, { data: { id: "n-1" } }]);
    expect(await markNotificationReadRecord(input)).toEqual({ ok: true, data: null });
  });

  it("reports not found when the row is not the caller's own", async () => {
    makeClient([{ data: [] }, { data: null }]);
    expect(await markNotificationReadRecord(input)).toEqual({
      ok: false,
      error: "Notification not found.",
    });
  });
});

describe("getUnreadNotificationCount", () => {
  it("uses an exact head count filtered to the recipient's unread rows", async () => {
    const queries = makeClient([{ count: 3 }]);
    expect(await getUnreadNotificationCount("student-auth")).toEqual({
      ok: true,
      data: 3,
    });
    expect(callsOf(queries[0], "select")[0]).toEqual([
      "id",
      { count: "exact", head: true },
    ]);
    expect(callsOf(queries[0], "eq")).toEqual([
      ["recipient_auth_user_id", "student-auth"],
      ["status", "unread"],
    ]);
  });
});

describe("searchNotificationRecipients", () => {
  it("does not query for blank or one-character searches", async () => {
    const queries = makeClient([]);
    expect(await searchNotificationRecipients("  ")).toEqual({ ok: true, data: [] });
    expect(await searchNotificationRecipients("a")).toEqual({ ok: true, data: [] });
    expect(queries).toHaveLength(0);
  });

  it("searches students with a login and trainers using a sanitized filter", async () => {
    const queries = makeClient([
      {
        data: [
          {
            id: "s1",
            auth_user_id: "sa",
            first_name: "Asha",
            last_name: "Rao",
            email: "a@x.test",
          },
        ],
      },
      {
        data: [
          {
            id: "t1",
            auth_user_id: "ta",
            first_name: "Tara",
            last_name: "Sen",
            email: "t@x.test",
          },
        ],
      },
    ]);
    const result = await searchNotificationRecipients("ra,id.eq.1");
    expect(result).toEqual({
      ok: true,
      data: [
        { kind: "student", profileId: "s1", name: "Asha Rao", email: "a@x.test" },
        { kind: "trainer", profileId: "t1", name: "Tara Sen", email: "t@x.test" },
      ],
    });
    expect(queries.map((q) => q.table)).toEqual(["students", "trainers"]);
    const filter = callsOf(queries[0], "or")[0][0] as string;
    expect(filter).toBe(
      "first_name.ilike.%raid.eq.1%,last_name.ilike.%raid.eq.1%,email.ilike.%raid.eq.1%",
    );
    expect(callsOf(queries[0], "not")[0]).toEqual(["auth_user_id", "is", null]);
  });
});
