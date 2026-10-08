import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 17 checkpoint finding: two independent live Windows runs each
 * showed the full certificate issuance pipeline — including the real
 * audit_logs INSERT — completing and committing correctly (confirmed
 * directly against the row itself), while the calling Server Action never
 * returned to the browser. The only awaited work after "certificate fully
 * issued" was this module's own unbounded `await` on acknowledging that
 * insert — a slow/dropped response for a write that already committed
 * server-side blocked the caller forever, contradicting this module's own
 * documented "must not block the underlying action" contract. This file
 * proves the fix: writeAuditLog now always resolves within
 * AUDIT_LOG_TIMEOUT_MS, even when the underlying insert never settles at
 * all — never a retry, never a thrown error reaching the caller.
 */

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/data/audit-log";

const ENTRY = {
  actorAuthUserId: "auth-1",
  actorRole: "admin" as const,
  action: "certificate.issue",
  entityType: "certificate",
  entityId: "cert-1",
  after: { enrollmentId: "enr-1", certificateNumber: "CERT-2026-000001" },
};

function mockInsert(behavior: { data: null; error: Error | null } | "never") {
  const insert = vi.fn(() => {
    if (behavior === "never") return new Promise(() => {}); // deliberately never settles
    return Promise.resolve(behavior);
  });
  const from = vi.fn().mockReturnValue({ insert });
  vi.mocked(createSupabaseAdminClient).mockReturnValue({ from } as never);
  return { insert, from };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("writeAuditLog", () => {
  it("writes the redacted entry and resolves on a normal fast insert", async () => {
    const { insert, from } = mockInsert({ data: null, error: null });

    await expect(writeAuditLog(ENTRY)).resolves.toBeUndefined();

    expect(from).toHaveBeenCalledWith("audit_logs");
    expect(insert).toHaveBeenCalledTimes(1);
    const [payload] = insert.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(payload.action).toBe("certificate.issue");
    expect(payload.entity_id).toBe("cert-1");
  });

  it("never throws when the insert itself returns an error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInsert({ data: null, error: new Error("insert failed") });

    await expect(writeAuditLog(ENTRY)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("resolves within the bounded timeout even when the insert never settles at all", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInsert("never");

    const pending = writeAuditLog(ENTRY);
    let settled = false;
    pending.then(() => {
      settled = true;
    });

    // Not yet timed out — the caller must not see a premature resolution.
    await vi.advanceTimersByTimeAsync(4000);
    expect(settled).toBe(false);

    // Crosses AUDIT_LOG_TIMEOUT_MS (5000ms) — must resolve now, never hang.
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("failed to write"),
      expect.objectContaining({ message: expect.stringContaining("timed out") }),
    );

    consoleError.mockRestore();
  });
});
