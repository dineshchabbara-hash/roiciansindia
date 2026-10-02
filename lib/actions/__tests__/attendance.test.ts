import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mirrors lib/actions/__tests__/class-sessions.test.ts's pattern: mock only
 * the true I/O boundary (lib/data/attendance.ts, lib/auth/session.ts) so
 * this exercises the real markAttendanceAction and the real
 * parseAttendanceRosterFormData it calls into, without a database.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/attendance", () => ({
  markAttendanceForClassSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { markAttendanceAction } from "@/lib/actions/attendance";
import { getCurrentUserContext } from "@/lib/auth/session";
import { markAttendanceForClassSession } from "@/lib/data/attendance";

const adminContext = {
  authUserId: "admin-auth-1",
  email: "admin@example.com",
  role: "admin" as const,
  profileId: "admin-profile-1",
  displayName: "Test Admin",
};

const superAdminContext = { ...adminContext, role: "super_admin" as const };

const trainerContext = {
  authUserId: "trainer-auth-1",
  email: "trainer@example.com",
  role: "trainer" as const,
  profileId: "trainer-profile-1",
  displayName: "Test Trainer",
};

const studentContext = {
  authUserId: "student-auth-1",
  email: "student@example.com",
  role: "student" as const,
  profileId: "student-profile-1",
  displayName: "Test Student",
};

function rosterFormData(
  entries: Array<{ enrollmentId: string; status?: string }>,
): FormData {
  const formData = new FormData();
  for (const entry of entries) {
    formData.set(`status__${entry.enrollmentId}`, entry.status ?? "");
  }
  return formData;
}

const ENR = "11111111-1111-4111-8111-111111111111";

describe("markAttendanceAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Trainer and Student — only Admin/Super Admin may use this action", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await markAttendanceAction(
        "batch-1",
        "session-1",
        {},
        rosterFormData([{ enrollmentId: ENR, status: "present" }]),
      );
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(markAttendanceForClassSession).not.toHaveBeenCalled();
  });

  it("allows Admin, passing marked_by_type 'admin' and the caller's own profileId", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(markAttendanceForClassSession).mockResolvedValue({
      ok: true,
      data: { marked: 1, corrected: 0, ignored: 0 },
    });

    const result = await markAttendanceAction(
      "batch-1",
      "session-1",
      {},
      rosterFormData([{ enrollmentId: ENR, status: "present" }]),
    );

    expect(result).toEqual({
      success: true,
      summary: { marked: 1, corrected: 0, ignored: 0 },
    });
    expect(markAttendanceForClassSession).toHaveBeenCalledWith(
      "batch-1",
      "session-1",
      [{ enrollmentId: ENR, status: "present", notes: null }],
      { id: "admin-profile-1", type: "admin" },
    );
  });

  it("allows Super Admin, the same as Admin", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(superAdminContext);
    vi.mocked(markAttendanceForClassSession).mockResolvedValue({
      ok: true,
      data: { marked: 0, corrected: 0, ignored: 0 },
    });

    const result = await markAttendanceAction(
      "batch-1",
      "session-1",
      {},
      rosterFormData([]),
    );
    expect(result.success).toBe(true);
    expect(markAttendanceForClassSession).toHaveBeenCalledWith(
      "batch-1",
      "session-1",
      [],
      { id: "admin-profile-1", type: "admin" },
    );
  });

  it("surfaces a data-layer error as a visible formError", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(markAttendanceForClassSession).mockResolvedValue({
      ok: false,
      error: "Class session not found.",
    });

    const result = await markAttendanceAction(
      "batch-1",
      "session-1",
      {},
      rosterFormData([{ enrollmentId: ENR, status: "present" }]),
    );
    expect(result).toEqual({ formError: "Class session not found." });
  });
});
