import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mirrors lib/actions/__tests__/class-sessions.test.ts's pattern, but for
 * the Trainer Portal actions — mocks only lib/data/trainer-portal.ts's
 * createMyClassSession/getMySession/updateMyClassSession*, lib/auth/session.ts,
 * and lib/data/audit-log.ts, exercising the real action's role check and the
 * real shared classSessionInputSchema/classSessionStatusSchema.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/trainer-portal", () => ({
  createMyClassSession: vi.fn(),
  getMySession: vi.fn(),
  updateMyClassSession: vi.fn(),
  updateMyClassSessionStatus: vi.fn(),
}));

vi.mock("@/lib/data/audit-log", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT_CALLED");
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  createMyClassSessionAction,
  updateMyClassSessionAction,
  updateMyClassSessionStatusAction,
} from "@/lib/actions/trainer-class-sessions";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  createMyClassSession,
  getMySession,
  updateMyClassSession,
  updateMyClassSessionStatus,
} from "@/lib/data/trainer-portal";
import { writeAuditLog } from "@/lib/data/audit-log";

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

function baseFormData(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  const fields: Record<string, string> = {
    sessionDate: "2026-09-01",
    startTime: "09:00",
    endTime: "11:00",
    topic: "Introduction",
    description: "",
    meetingLink: "",
    notes: "",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

const baseSessionRow = {
  id: "session-1",
  batchId: "batch-1",
  trainerId: "trainer-profile-1",
  trainerName: "Test Trainer",
  sessionDate: "2026-09-01",
  startTime: "09:00:00",
  endTime: "11:00:00",
  topic: "Introduction",
  description: null,
  meetingLink: null,
  status: "scheduled" as const,
  notes: null,
};

describe("createMyClassSessionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(trainerContext);
  });

  it("rejects Admin and Student — only a Trainer may use this action", async () => {
    for (const ctx of [adminContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await createMyClassSessionAction("batch-1", {}, baseFormData());
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(createMyClassSession).not.toHaveBeenCalled();
  });

  it("allows a Trainer, delegating batch-ownership verification to the data layer", async () => {
    vi.mocked(createMyClassSession).mockResolvedValue({
      ok: true,
      data: { id: "session-1" },
    });
    await expect(
      createMyClassSessionAction("batch-1", {}, baseFormData()),
    ).rejects.toThrow("REDIRECT_CALLED");

    expect(createMyClassSession).toHaveBeenCalledWith(
      "batch-1",
      expect.objectContaining({ sessionDate: "2026-09-01" }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "class_session.create",
        actorRole: "trainer",
        entityId: "session-1",
      }),
    );
  });

  it("surfaces an unassigned-batch rejection from the data layer as a visible error", async () => {
    vi.mocked(createMyClassSession).mockResolvedValue({
      ok: false,
      error: "Batch not found.",
    });
    const result = await createMyClassSessionAction(
      "unassigned-batch",
      {},
      baseFormData(),
    );
    expect(result.formError).toBe("Batch not found.");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects an end time before the start time before ever calling the data layer", async () => {
    const result = await createMyClassSessionAction(
      "batch-1",
      {},
      baseFormData({ startTime: "11:00", endTime: "09:00" }),
    );
    expect(result.fieldErrors?.endTime?.[0]).toMatch(/cannot be before/i);
    expect(createMyClassSession).not.toHaveBeenCalled();
  });
});

describe("updateMyClassSessionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(trainerContext);
    vi.mocked(getMySession).mockResolvedValue({ ok: true, data: baseSessionRow });
    vi.mocked(updateMyClassSession).mockResolvedValue({ ok: true, data: null });
  });

  it("rejects Admin and Student", async () => {
    for (const ctx of [adminContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await updateMyClassSessionAction(
        "batch-1",
        "session-1",
        {},
        baseFormData(),
      );
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(updateMyClassSession).not.toHaveBeenCalled();
  });

  it("surfaces the data layer's ownership rejection without updating", async () => {
    vi.mocked(getMySession).mockResolvedValue({ ok: false, error: "Batch not found." });
    const result = await updateMyClassSessionAction(
      "unassigned-batch",
      "session-1",
      {},
      baseFormData(),
    );
    expect(result.formError).toBe("Batch not found.");
    expect(updateMyClassSession).not.toHaveBeenCalled();
  });

  it("allows the assigned Trainer and writes an audit log", async () => {
    await expect(
      updateMyClassSessionAction(
        "batch-1",
        "session-1",
        {},
        baseFormData({ topic: "Renamed" }),
      ),
    ).rejects.toThrow("REDIRECT_CALLED");
    expect(updateMyClassSession).toHaveBeenCalledWith(
      "batch-1",
      "session-1",
      expect.objectContaining({ topic: "Renamed" }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "class_session.update", actorRole: "trainer" }),
    );
  });
});

describe("updateMyClassSessionStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(trainerContext);
    vi.mocked(getMySession).mockResolvedValue({ ok: true, data: baseSessionRow });
    vi.mocked(updateMyClassSessionStatus).mockResolvedValue({ ok: true, data: null });
  });

  it("rejects Admin and Student", async () => {
    for (const ctx of [adminContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const formData = new FormData();
      formData.set("status", "completed");
      const result = await updateMyClassSessionStatusAction(
        "batch-1",
        "session-1",
        {},
        formData,
      );
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(updateMyClassSessionStatus).not.toHaveBeenCalled();
  });

  it("allows the assigned Trainer and audits the before/after status", async () => {
    const formData = new FormData();
    formData.set("status", "completed");
    const result = await updateMyClassSessionStatusAction(
      "batch-1",
      "session-1",
      {},
      formData,
    );
    expect(result.success).toBe(true);
    expect(updateMyClassSessionStatus).toHaveBeenCalledWith(
      "batch-1",
      "session-1",
      "completed",
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "class_session.status_change",
        before: { status: "scheduled" },
        after: { status: "completed" },
      }),
    );
  });
});
