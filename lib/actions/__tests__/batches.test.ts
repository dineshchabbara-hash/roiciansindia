import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mirrors lib/actions/__tests__/programs.test.ts's pattern: mock only the
 * true I/O boundary (lib/data/batches.ts, lib/auth/session.ts,
 * lib/data/audit-log.ts) so this exercises the real createBatchAction/
 * updateBatchAction/setBatchStatusAction/assignTrainerAction/
 * unassignTrainerAction and the real batchProfileSchema/
 * trainerAssignmentSchema they call into, without a database.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/batches", () => ({
  assignTrainerToBatch: vi.fn(),
  createBatchRecord: vi.fn(),
  findExistingAssignment: vi.fn(),
  getBatchProfile: vi.fn(),
  unassignTrainerFromBatch: vi.fn(),
  updateBatchProfile: vi.fn(),
  updateBatchStatus: vi.fn(),
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
  assignTrainerAction,
  createBatchAction,
  setBatchStatusAction,
  unassignTrainerAction,
  updateBatchAction,
} from "@/lib/actions/batches";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  assignTrainerToBatch,
  createBatchRecord,
  findExistingAssignment,
  getBatchProfile,
  unassignTrainerFromBatch,
  updateBatchProfile,
  updateBatchStatus,
} from "@/lib/data/batches";
import { writeAuditLog } from "@/lib/data/audit-log";

const VALID_PROGRAM_ID = "11111111-1111-4111-8111-111111111111";
const VALID_TRAINER_ID = "22222222-2222-4222-8222-222222222222";

const adminContext = {
  authUserId: "admin-auth-1",
  email: "admin@example.com",
  role: "admin" as const,
  profileId: "admin-profile-1",
  displayName: "Test Admin",
};

const superAdminContext = {
  authUserId: "super-admin-auth-1",
  email: "superadmin@example.com",
  role: "super_admin" as const,
  profileId: "super-admin-profile-1",
  displayName: "Test Super Admin",
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
    programId: VALID_PROGRAM_ID,
    name: "September 2026 Weekend Batch",
    startDate: "2026-09-01",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

const baseBatchProfile = {
  id: "batch-1",
  programId: VALID_PROGRAM_ID,
  programName: "Full Stack Development",
  programCode: "FSD-101",
  name: "September 2026 Weekend Batch",
  startDate: "2026-09-01",
  expectedEndDate: null,
  daysOfWeek: [] as string[],
  startTime: null,
  endTime: null,
  timezone: "Asia/Kolkata",
  deliveryMode: null,
  capacity: null,
  status: "draft" as const,
  meetingLink: null,
  location: null,
  notes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("createBatchAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
  });

  it("rejects Trainer and Student before ever creating a record", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await createBatchAction({}, baseFormData());
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(createBatchRecord).not.toHaveBeenCalled();
  });

  it("allows Admin and Super Admin", async () => {
    vi.mocked(createBatchRecord).mockResolvedValue({ ok: true, data: { id: "batch-1" } });
    for (const ctx of [adminContext, superAdminContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      await expect(createBatchAction({}, baseFormData())).rejects.toThrow(
        "REDIRECT_CALLED",
      );
    }
    expect(createBatchRecord).toHaveBeenCalledTimes(2);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "batch.create",
        entityId: "batch-1",
        after: { name: "September 2026 Weekend Batch" },
      }),
    );
  });

  it("rejects a missing program/name/start date with field errors, never creating a record", async () => {
    const result = await createBatchAction(
      {},
      baseFormData({ programId: "", name: "", startDate: "" }),
    );
    expect(result.fieldErrors?.programId).toBeTruthy();
    expect(result.fieldErrors?.name).toBeTruthy();
    expect(result.fieldErrors?.startDate).toBeTruthy();
    expect(createBatchRecord).not.toHaveBeenCalled();
  });

  it("rejects an expected end date before the start date", async () => {
    const result = await createBatchAction(
      {},
      baseFormData({ startDate: "2026-09-01", expectedEndDate: "2026-08-01" }),
    );
    expect(result.fieldErrors?.expectedEndDate?.[0]).toMatch(/cannot be before/i);
    expect(createBatchRecord).not.toHaveBeenCalled();
  });

  it("surfaces a create failure (e.g. an invalid program reference) as a visible error", async () => {
    vi.mocked(createBatchRecord).mockResolvedValue({
      ok: false,
      error: "Selected program could not be found. Please choose a valid program.",
    });
    const result = await createBatchAction({}, baseFormData());
    expect(result.formError).toBe(
      "Selected program could not be found. Please choose a valid program.",
    );
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("updateBatchAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(getBatchProfile).mockResolvedValue({ ok: true, data: baseBatchProfile });
    vi.mocked(updateBatchProfile).mockResolvedValue({ ok: true, data: null });
  });

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await updateBatchAction("batch-1", {}, baseFormData());
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(updateBatchProfile).not.toHaveBeenCalled();
  });

  it("never audits programId as a changed field, even if a tampered form submits a different one", async () => {
    await expect(
      updateBatchAction(
        "batch-1",
        {},
        baseFormData({
          programId: "33333333-3333-4333-8333-333333333333",
          name: "Renamed Batch",
        }),
      ),
    ).rejects.toThrow("REDIRECT_CALLED");

    const call = vi.mocked(writeAuditLog).mock.calls[0][0];
    expect(call.after).toEqual({ changedFields: ["name"] });
  });

  it("surfaces a save failure as a visible error", async () => {
    vi.mocked(updateBatchProfile).mockResolvedValue({
      ok: false,
      error: "Could not save changes. Please try again.",
    });
    const result = await updateBatchAction("batch-1", {}, baseFormData());
    expect(result.formError).toBe("Could not save changes. Please try again.");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("setBatchStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(getBatchProfile).mockResolvedValue({ ok: true, data: baseBatchProfile });
    vi.mocked(updateBatchStatus).mockResolvedValue({ ok: true, data: null });
  });

  it("rejects Trainer and Student", async () => {
    const formData = new FormData();
    formData.set("status", "active");
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await setBatchStatusAction("batch-1", {}, formData);
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(updateBatchStatus).not.toHaveBeenCalled();
  });

  it("accepts every schema-supported status and audits before/after", async () => {
    for (const status of [
      "draft",
      "upcoming",
      "active",
      "completed",
      "cancelled",
      "archived",
    ]) {
      vi.mocked(updateBatchStatus).mockClear();
      vi.mocked(writeAuditLog).mockClear();
      const formData = new FormData();
      formData.set("status", status);
      const result = await setBatchStatusAction("batch-1", {}, formData);
      expect(result.success).toBe(true);
      expect(updateBatchStatus).toHaveBeenCalledWith("batch-1", status);
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "batch.status_change",
          before: { status: "draft" },
          after: { status },
        }),
      );
    }
  });

  it("rejects a status value outside the schema's CHECK constraint", async () => {
    const formData = new FormData();
    formData.set("status", "paused");
    const result = await setBatchStatusAction("batch-1", {}, formData);
    expect(result.fieldErrors?.status).toBeTruthy();
    expect(updateBatchStatus).not.toHaveBeenCalled();
  });
});

describe("assignTrainerAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(findExistingAssignment).mockResolvedValue({ ok: true, data: false });
    vi.mocked(assignTrainerToBatch).mockResolvedValue({ ok: true, data: null });
  });

  it("rejects Trainer and Student", async () => {
    const formData = new FormData();
    formData.set("trainerId", VALID_TRAINER_ID);
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await assignTrainerAction("batch-1", {}, formData);
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(assignTrainerToBatch).not.toHaveBeenCalled();
  });

  it("hard-blocks a duplicate assignment with a visible field error and never inserts", async () => {
    vi.mocked(findExistingAssignment).mockResolvedValue({ ok: true, data: true });
    const formData = new FormData();
    formData.set("trainerId", VALID_TRAINER_ID);

    const result = await assignTrainerAction("batch-1", {}, formData);

    expect(result.fieldErrors?.trainerId?.[0]).toBe(
      "This trainer is already assigned to this batch.",
    );
    expect(assignTrainerToBatch).not.toHaveBeenCalled();
  });

  it("surfaces a failed duplicate check as a visible error rather than silently assigning", async () => {
    vi.mocked(findExistingAssignment).mockResolvedValue({
      ok: false,
      error: "Could not check the trainer's existing assignments.",
    });
    const formData = new FormData();
    formData.set("trainerId", VALID_TRAINER_ID);

    const result = await assignTrainerAction("batch-1", {}, formData);
    expect(result.formError).toBe("Could not check the trainer's existing assignments.");
    expect(assignTrainerToBatch).not.toHaveBeenCalled();
  });

  it("assigns the trainer and audits with the isPrimary flag, minimal metadata only", async () => {
    const formData = new FormData();
    formData.set("trainerId", VALID_TRAINER_ID);
    formData.set("isPrimary", "on");

    const result = await assignTrainerAction("batch-1", {}, formData);

    expect(result.success).toBe(true);
    expect(assignTrainerToBatch).toHaveBeenCalledWith("batch-1", VALID_TRAINER_ID, true);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "batch.trainer_assigned",
        entityId: "batch-1",
        after: { trainerId: VALID_TRAINER_ID, isPrimary: true },
      }),
    );
  });

  it("rejects a missing/invalid trainer id", async () => {
    const formData = new FormData();
    formData.set("trainerId", "");
    const result = await assignTrainerAction("batch-1", {}, formData);
    expect(result.fieldErrors?.trainerId).toBeTruthy();
    expect(findExistingAssignment).not.toHaveBeenCalled();
  });
});

describe("unassignTrainerAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(unassignTrainerFromBatch).mockResolvedValue({ ok: true, data: null });
  });

  it("rejects Trainer and Student", async () => {
    const formData = new FormData();
    formData.set("trainerId", VALID_TRAINER_ID);
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await unassignTrainerAction("batch-1", {}, formData);
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(unassignTrainerFromBatch).not.toHaveBeenCalled();
  });

  it("unassigns the trainer and audits minimally", async () => {
    const formData = new FormData();
    formData.set("trainerId", VALID_TRAINER_ID);

    const result = await unassignTrainerAction("batch-1", {}, formData);

    expect(result.success).toBe(true);
    expect(unassignTrainerFromBatch).toHaveBeenCalledWith("batch-1", VALID_TRAINER_ID);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "batch.trainer_unassigned",
        entityId: "batch-1",
        before: { trainerId: VALID_TRAINER_ID },
      }),
    );
  });

  it("surfaces an unassign failure as a visible error", async () => {
    vi.mocked(unassignTrainerFromBatch).mockResolvedValue({
      ok: false,
      error: "Could not unassign the trainer. Please try again.",
    });
    const formData = new FormData();
    formData.set("trainerId", VALID_TRAINER_ID);

    const result = await unassignTrainerAction("batch-1", {}, formData);
    expect(result.formError).toBe("Could not unassign the trainer. Please try again.");
  });
});
