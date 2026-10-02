import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mirrors lib/actions/__tests__/trainer-class-sessions.test.ts's pattern:
 * mocks only lib/data/trainer-portal.ts's markMyAttendanceForSession and
 * lib/auth/session.ts, exercising the real markMyAttendanceAction and the
 * real parseAttendanceRosterFormData it calls into.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/trainer-portal", () => ({
  markMyAttendanceForSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { markMyAttendanceAction } from "@/lib/actions/trainer-attendance";
import { getCurrentUserContext } from "@/lib/auth/session";
import { markMyAttendanceForSession } from "@/lib/data/trainer-portal";

const trainerContext = {
  authUserId: "trainer-auth-1",
  email: "trainer@example.com",
  role: "trainer" as const,
  profileId: "trainer-profile-1",
  displayName: "Test Trainer",
};

const adminContext = {
  authUserId: "admin-auth-1",
  email: "admin@example.com",
  role: "admin" as const,
  profileId: "admin-profile-1",
  displayName: "Test Admin",
};

const studentContext = {
  authUserId: "student-auth-1",
  email: "student@example.com",
  role: "student" as const,
  profileId: "student-profile-1",
  displayName: "Test Student",
};

const ENR = "11111111-1111-4111-8111-111111111111";

function rosterFormData(
  entries: Array<{ enrollmentId: string; status?: string }>,
): FormData {
  const formData = new FormData();
  for (const entry of entries) {
    formData.set(`status__${entry.enrollmentId}`, entry.status ?? "");
  }
  return formData;
}

describe("markMyAttendanceAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Admin and Student — only a Trainer may use this action", async () => {
    for (const ctx of [adminContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await markMyAttendanceAction(
        "batch-1",
        "session-1",
        {},
        rosterFormData([{ enrollmentId: ENR, status: "present" }]),
      );
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(markMyAttendanceForSession).not.toHaveBeenCalled();
  });

  it("allows a Trainer, delegating batch/eligibility verification to the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(trainerContext);
    vi.mocked(markMyAttendanceForSession).mockResolvedValue({
      ok: true,
      data: { marked: 1, corrected: 0, ignored: 0 },
    });

    const result = await markMyAttendanceAction(
      "batch-1",
      "session-1",
      {},
      rosterFormData([{ enrollmentId: ENR, status: "absent" }]),
    );

    expect(result).toEqual({
      success: true,
      summary: { marked: 1, corrected: 0, ignored: 0 },
    });
    expect(markMyAttendanceForSession).toHaveBeenCalledWith("batch-1", "session-1", [
      { enrollmentId: ENR, status: "absent", notes: null },
    ]);
  });

  it("surfaces an unassigned-batch rejection from the data layer as a visible error", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(trainerContext);
    vi.mocked(markMyAttendanceForSession).mockResolvedValue({
      ok: false,
      error: "Batch not found.",
    });

    const result = await markMyAttendanceAction(
      "unassigned-batch",
      "session-1",
      {},
      rosterFormData([{ enrollmentId: ENR, status: "present" }]),
    );
    expect(result).toEqual({ formError: "Batch not found." });
  });
});
