import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Same mocking pattern as lib/actions/__tests__/materials.test.ts — mocks
 * the true I/O boundary (lib/data/trainer-portal's createMyMaterial,
 * lib/auth/session, lib/data/audit-log, next/cache) so this exercises the
 * real action and the real validation/file-check chain it shares with the
 * Admin action, without a database.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/trainer-portal", () => ({
  createMyMaterial: vi.fn(),
}));

vi.mock("@/lib/data/audit-log", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  createMyBatchMaterialAction,
  createMySessionMaterialAction,
} from "@/lib/actions/trainer-materials";
import { getCurrentUserContext } from "@/lib/auth/session";
import { createMyMaterial } from "@/lib/data/trainer-portal";

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

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

function linkFormData(): FormData {
  const formData = new FormData();
  formData.set("title", "A material");
  formData.set("materialType", "link");
  formData.set("externalUrl", "https://example.com/doc");
  return formData;
}

describe("createMyBatchMaterialAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Admin and Student — Trainer-only action", async () => {
    for (const ctx of [adminContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await createMyBatchMaterialAction("batch-1", {}, linkFormData());
      expect(result.formError).toBe(NOT_AUTHORIZED);
    }
    expect(createMyMaterial).not.toHaveBeenCalled();
  });

  it("allows Trainer and scopes to the bound Batch", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(trainerContext);
    vi.mocked(createMyMaterial).mockResolvedValue({ ok: true, data: { id: "mat-1" } });

    const result = await createMyBatchMaterialAction("batch-1", {}, linkFormData());
    expect(result).toEqual({ success: true });
    expect(createMyMaterial).toHaveBeenCalledWith(
      { type: "batch", batchId: "batch-1" },
      expect.objectContaining({ title: "A material" }),
      null,
    );
  });

  it("surfaces a data-layer denial (e.g. not assigned to this Batch) as a formError", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(trainerContext);
    vi.mocked(createMyMaterial).mockResolvedValue({
      ok: false,
      error: "Batch not found.",
    });

    const result = await createMyBatchMaterialAction("batch-1", {}, linkFormData());
    expect(result).toEqual({ formError: "Batch not found." });
  });
});

describe("createMySessionMaterialAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Admin and Student — Trainer-only action", async () => {
    for (const ctx of [adminContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await createMySessionMaterialAction(
        "batch-1",
        "session-1",
        {},
        linkFormData(),
      );
      expect(result.formError).toBe(NOT_AUTHORIZED);
    }
    expect(createMyMaterial).not.toHaveBeenCalled();
  });

  it("allows Trainer and scopes to the bound Session", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(trainerContext);
    vi.mocked(createMyMaterial).mockResolvedValue({ ok: true, data: { id: "mat-2" } });

    const result = await createMySessionMaterialAction(
      "batch-1",
      "session-1",
      {},
      linkFormData(),
    );
    expect(result).toEqual({ success: true });
    expect(createMyMaterial).toHaveBeenCalledWith(
      { type: "session", batchId: "batch-1", sessionId: "session-1" },
      expect.objectContaining({ title: "A material" }),
      null,
    );
  });
});
