import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mirrors lib/actions/__tests__/batches.test.ts's pattern: mock only the
 * true I/O boundary (lib/data/class-sessions.ts, lib/auth/session.ts,
 * lib/data/audit-log.ts) so this exercises the real createClassSessionAction/
 * updateClassSessionAction/updateClassSessionStatusAction and the real
 * classSessionInputSchema/classSessionStatusSchema they call into, without a
 * database.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/class-sessions", () => ({
  createClassSession: vi.fn(),
  getClassSession: vi.fn(),
  updateClassSession: vi.fn(),
  updateClassSessionStatus: vi.fn(),
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
  createClassSessionAction,
  updateClassSessionAction,
  updateClassSessionStatusAction,
} from "@/lib/actions/class-sessions";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  createClassSession,
  getClassSession,
  updateClassSession,
  updateClassSessionStatus,
} from "@/lib/data/class-sessions";
import { writeAuditLog } from "@/lib/data/audit-log";

const adminContext = {
  authUserId: "admin-auth-1",
  email: "admin@example.com",
  role: "admin" as const,
  profileId: "admin-profile-1",
  displayName: "Test Admin",
};

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
  trainerId: null,
  trainerName: null,
  sessionDate: "2026-09-01",
  startTime: "09:00:00",
  endTime: "11:00:00",
  topic: "Introduction",
  description: null,
  meetingLink: null,
  status: "scheduled" as const,
  notes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("createClassSessionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
  });

  it("rejects Trainer and Student before ever creating a record", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await createClassSessionAction("batch-1", {}, baseFormData());
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(createClassSession).not.toHaveBeenCalled();
  });

  it("allows Admin, scoping the insert to the bound batchId — never a form field", async () => {
    vi.mocked(createClassSession).mockResolvedValue({
      ok: true,
      data: { id: "session-1" },
    });
    await expect(createClassSessionAction("batch-1", {}, baseFormData())).rejects.toThrow(
      "REDIRECT_CALLED",
    );

    expect(createClassSession).toHaveBeenCalledWith(
      "batch-1",
      expect.objectContaining({ sessionDate: "2026-09-01" }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "class_session.create", entityId: "session-1" }),
    );
  });

  it("rejects a missing session date with a field error, never creating a record", async () => {
    const result = await createClassSessionAction(
      "batch-1",
      {},
      baseFormData({ sessionDate: "" }),
    );
    expect(result.fieldErrors?.sessionDate).toBeTruthy();
    expect(createClassSession).not.toHaveBeenCalled();
  });

  it("rejects an end time before the start time", async () => {
    const result = await createClassSessionAction(
      "batch-1",
      {},
      baseFormData({ startTime: "11:00", endTime: "09:00" }),
    );
    expect(result.fieldErrors?.endTime?.[0]).toMatch(/cannot be before/i);
    expect(createClassSession).not.toHaveBeenCalled();
  });

  it("surfaces a create failure as a visible error", async () => {
    vi.mocked(createClassSession).mockResolvedValue({
      ok: false,
      error: "Selected batch could not be found.",
    });
    const result = await createClassSessionAction("batch-1", {}, baseFormData());
    expect(result.formError).toBe("Selected batch could not be found.");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("updateClassSessionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(getClassSession).mockResolvedValue({ ok: true, data: baseSessionRow });
    vi.mocked(updateClassSession).mockResolvedValue({ ok: true, data: null });
  });

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await updateClassSessionAction(
        "batch-1",
        "session-1",
        {},
        baseFormData(),
      );
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(updateClassSession).not.toHaveBeenCalled();
  });

  it("verifies the batch/session pair before writing, 404-style error on mismatch", async () => {
    vi.mocked(getClassSession).mockResolvedValue({
      ok: false,
      error: "Class session not found.",
    });
    const result = await updateClassSessionAction(
      "wrong-batch",
      "session-1",
      {},
      baseFormData(),
    );
    expect(result.formError).toBe("Class session not found.");
    expect(updateClassSession).not.toHaveBeenCalled();
  });

  it("allows Admin and writes an audit log", async () => {
    await expect(
      updateClassSessionAction(
        "batch-1",
        "session-1",
        {},
        baseFormData({ topic: "Renamed" }),
      ),
    ).rejects.toThrow("REDIRECT_CALLED");
    expect(updateClassSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ topic: "Renamed" }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "class_session.update", entityId: "session-1" }),
    );
  });
});

describe("updateClassSessionStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(getClassSession).mockResolvedValue({ ok: true, data: baseSessionRow });
    vi.mocked(updateClassSessionStatus).mockResolvedValue({ ok: true, data: null });
  });

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const formData = new FormData();
      formData.set("status", "completed");
      const result = await updateClassSessionStatusAction(
        "batch-1",
        "session-1",
        {},
        formData,
      );
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(updateClassSessionStatus).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value", async () => {
    const formData = new FormData();
    formData.set("status", "present");
    const result = await updateClassSessionStatusAction(
      "batch-1",
      "session-1",
      {},
      formData,
    );
    expect(result.fieldErrors?.status).toBeTruthy();
    expect(updateClassSessionStatus).not.toHaveBeenCalled();
  });

  it("allows Admin and audits the before/after status", async () => {
    const formData = new FormData();
    formData.set("status", "completed");
    const result = await updateClassSessionStatusAction(
      "batch-1",
      "session-1",
      {},
      formData,
    );
    expect(result.success).toBe(true);
    expect(updateClassSessionStatus).toHaveBeenCalledWith("session-1", "completed");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "class_session.status_change",
        before: { status: "scheduled" },
        after: { status: "completed" },
      }),
    );
  });
});
