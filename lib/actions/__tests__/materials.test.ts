import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mirrors lib/actions/__tests__/payment-plans.test.ts's own pattern: mock
 * the true I/O boundary (lib/data/materials, lib/auth/session,
 * lib/data/audit-log, next/cache) so this exercises the real actions and
 * the real lib/validation/materials.ts + lib/domain/materials.ts logic they
 * call into (auth gate, scope resolution, file validation chain), without a
 * database or real file bytes.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/materials", () => ({
  createMaterialRecord: vi.fn(),
  getMaterialAccessUrl: vi.fn(),
  listProgramModules: vi.fn(),
}));

vi.mock("@/lib/data/audit-log", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  createProgramMaterialAction,
  createBatchMaterialAction,
  createSessionMaterialAction,
  getMaterialAccessUrlAction,
} from "@/lib/actions/materials";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  createMaterialRecord,
  getMaterialAccessUrl,
  listProgramModules,
} from "@/lib/data/materials";

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

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

function linkFormData(fields: {
  title?: string;
  externalUrl?: string;
  moduleId?: string;
}) {
  const formData = new FormData();
  formData.set("title", fields.title ?? "A material");
  formData.set("materialType", "link");
  formData.set("externalUrl", fields.externalUrl ?? "https://example.com/doc");
  if (fields.moduleId !== undefined) formData.set("moduleId", fields.moduleId);
  return formData;
}

function fileFormData(file: File) {
  const formData = new FormData();
  formData.set("title", "A file material");
  formData.set("materialType", "file");
  formData.set("file", file);
  return formData;
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe("createProgramMaterialAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await createProgramMaterialAction("prog-1", {}, linkFormData({}));
      expect(result.formError).toBe(NOT_AUTHORIZED);
    }
    expect(createMaterialRecord).not.toHaveBeenCalled();
  });

  it("allows Admin and scopes to the bound Program when no moduleId is submitted", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(createMaterialRecord).mockResolvedValue({
      ok: true,
      data: { id: "mat-1" },
    });

    const result = await createProgramMaterialAction("prog-1", {}, linkFormData({}));
    expect(result).toEqual({ success: true });
    expect(createMaterialRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { type: "program", id: "prog-1" },
        uploadedBy: adminContext.profileId,
        uploadedByType: "admin",
      }),
    );
  });

  it("scopes to the Module instead of the bound Program when moduleId is submitted and actually belongs to that Program", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    const moduleId = "11111111-1111-4111-8111-111111111111";
    vi.mocked(listProgramModules).mockResolvedValue({
      ok: true,
      data: [{ id: moduleId, title: "Module 1" }],
    });
    vi.mocked(createMaterialRecord).mockResolvedValue({
      ok: true,
      data: { id: "mat-2" },
    });

    const result = await createProgramMaterialAction(
      "prog-1",
      {},
      linkFormData({ moduleId }),
    );
    expect(result).toEqual({ success: true });
    expect(listProgramModules).toHaveBeenCalledWith("prog-1");
    expect(createMaterialRecord).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { type: "module", id: moduleId } }),
    );
  });

  it("rejects a moduleId that does not belong to the bound Program (tampered direct POST), before reaching the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    const unrelatedModuleId = "22222222-2222-4222-8222-222222222222";
    // listProgramModules(programId) lists THIS program's own modules only
    // — the submitted moduleId does not appear in it.
    vi.mocked(listProgramModules).mockResolvedValue({
      ok: true,
      data: [{ id: "11111111-1111-4111-8111-111111111111", title: "A real module" }],
    });

    const result = await createProgramMaterialAction(
      "prog-1",
      {},
      linkFormData({ moduleId: unrelatedModuleId }),
    );
    expect(result.formError).toBeTruthy();
    expect(createMaterialRecord).not.toHaveBeenCalled();
  });

  it("rejects when listProgramModules itself fails, before reaching the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(listProgramModules).mockResolvedValue({
      ok: false,
      error: "Could not load modules.",
    });

    const result = await createProgramMaterialAction(
      "prog-1",
      {},
      linkFormData({ moduleId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(result.formError).toBeTruthy();
    expect(createMaterialRecord).not.toHaveBeenCalled();
  });

  it("surfaces a data-layer error as a visible formError", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(createMaterialRecord).mockResolvedValue({
      ok: false,
      error: "Could not create the material. Please try again.",
    });

    const result = await createProgramMaterialAction("prog-1", {}, linkFormData({}));
    expect(result).toEqual({
      formError: "Could not create the material. Please try again.",
    });
  });

  it("rejects when the admin profile id cannot be resolved, before reaching the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue({
      ...adminContext,
      profileId: null,
    });
    const result = await createProgramMaterialAction("prog-1", {}, linkFormData({}));
    expect(result.formError).toBeTruthy();
    expect(createMaterialRecord).not.toHaveBeenCalled();
  });

  it("rejects shape-invalid form data before reaching the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    const result = await createProgramMaterialAction(
      "prog-1",
      {},
      linkFormData({ title: "" }),
    );
    expect(result.formError).toBeTruthy();
    expect(createMaterialRecord).not.toHaveBeenCalled();
  });

  it("rejects a disallowed file extension before reaching the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    const file = new File([new Uint8Array([1, 2, 3])], "virus.exe", {
      type: "application/octet-stream",
    });
    const result = await createProgramMaterialAction("prog-1", {}, fileFormData(file));
    expect(result.formError).toMatch(/unsupported file type/i);
    expect(createMaterialRecord).not.toHaveBeenCalled();
  });

  it("rejects a file whose content does not match its claimed extension", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    // Claims .pdf but the bytes are a PNG signature — matchesMaterialFileSignature
    // (lib/domain/materials.ts) must reject this from the actual bytes, not
    // the trusted extension/Content-Type alone.
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = new File([pngBytes], "fake.pdf", { type: "application/pdf" });
    const result = await createProgramMaterialAction("prog-1", {}, fileFormData(file));
    expect(result.formError).toMatch(/does not match its extension/i);
    expect(createMaterialRecord).not.toHaveBeenCalled();
  });

  it("allows a correctly-signed file and forwards it to the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(createMaterialRecord).mockResolvedValue({
      ok: true,
      data: { id: "mat-3" },
    });

    const file = new File([PDF_BYTES], "notes.pdf", { type: "application/pdf" });
    const result = await createProgramMaterialAction("prog-1", {}, fileFormData(file));
    expect(result).toEqual({ success: true });
    expect(createMaterialRecord).toHaveBeenCalledWith(
      expect.objectContaining({ file: expect.anything() }),
    );
  });
});

describe("createBatchMaterialAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await createBatchMaterialAction("batch-1", {}, linkFormData({}));
      expect(result.formError).toBe(NOT_AUTHORIZED);
    }
    expect(createMaterialRecord).not.toHaveBeenCalled();
  });

  it("allows Admin and scopes to the bound Batch", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(createMaterialRecord).mockResolvedValue({
      ok: true,
      data: { id: "mat-4" },
    });

    const result = await createBatchMaterialAction("batch-1", {}, linkFormData({}));
    expect(result).toEqual({ success: true });
    expect(createMaterialRecord).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { type: "batch", id: "batch-1" } }),
    );
  });
});

describe("createSessionMaterialAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await createSessionMaterialAction(
        "batch-1",
        "session-1",
        {},
        linkFormData({}),
      );
      expect(result.formError).toBe(NOT_AUTHORIZED);
    }
    expect(createMaterialRecord).not.toHaveBeenCalled();
  });

  it("allows Admin and scopes to the bound Session", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(createMaterialRecord).mockResolvedValue({
      ok: true,
      data: { id: "mat-5" },
    });

    const result = await createSessionMaterialAction(
      "batch-1",
      "session-1",
      {},
      linkFormData({}),
    );
    expect(result).toEqual({ success: true });
    expect(createMaterialRecord).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { type: "session", id: "session-1" } }),
    );
  });
});

describe("getMaterialAccessUrlAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an unauthenticated caller before reaching the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(null);
    const result = await getMaterialAccessUrlAction("mat-1");
    expect(result).toEqual({ ok: false, error: NOT_AUTHORIZED });
    expect(getMaterialAccessUrl).not.toHaveBeenCalled();
  });

  it("defers entirely to the data layer's own RLS-based authorization for any authenticated role", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(studentContext);
    vi.mocked(getMaterialAccessUrl).mockResolvedValue({
      ok: true,
      data: { kind: "external_url", url: "https://example.com/doc" },
    });

    const result = await getMaterialAccessUrlAction("mat-1");
    expect(result).toEqual({ ok: true, url: "https://example.com/doc" });
    expect(getMaterialAccessUrl).toHaveBeenCalledWith("mat-1");
  });

  it("surfaces a data-layer denial (e.g. not found/not authorized) as-is", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(studentContext);
    vi.mocked(getMaterialAccessUrl).mockResolvedValue({
      ok: false,
      error: "Material not found.",
    });

    const result = await getMaterialAccessUrlAction("mat-1");
    expect(result).toEqual({ ok: false, error: "Material not found." });
  });
});
