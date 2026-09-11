import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mirrors lib/actions/__tests__/trainers.test.ts's pattern: mock only the
 * true I/O boundary (lib/data/programs.ts, lib/auth/session.ts,
 * lib/data/audit-log.ts) so this exercises the real
 * createProgramAction/updateProgramAction/setProgramStatusAction and the
 * real programProfileSchema they call into, without a database.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/programs", () => ({
  createProgramRecord: vi.fn(),
  findProgramByExactCode: vi.fn(),
  getProgramCodePattern: vi.fn(),
  getProgramProfile: vi.fn(),
  updateProgramProfile: vi.fn(),
  updateProgramStatus: vi.fn(),
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
  createProgramAction,
  updateProgramAction,
  setProgramStatusAction,
} from "@/lib/actions/programs";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  createProgramRecord,
  findProgramByExactCode,
  getProgramCodePattern,
  getProgramProfile,
  updateProgramProfile,
  updateProgramStatus,
} from "@/lib/data/programs";
import { writeAuditLog } from "@/lib/data/audit-log";

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
    programCode: "FSD-101",
    name: "Full Stack Development",
    regularFee: "50000",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("createProgramAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(getProgramCodePattern).mockResolvedValue({ ok: true, data: null });
    vi.mocked(findProgramByExactCode).mockResolvedValue({ ok: true, data: null });
  });

  it("rejects Trainer and Student before ever checking for a duplicate code or creating a record", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await createProgramAction({}, baseFormData());
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(findProgramByExactCode).not.toHaveBeenCalled();
    expect(createProgramRecord).not.toHaveBeenCalled();
  });

  it("allows Admin and Super Admin", async () => {
    vi.mocked(createProgramRecord).mockResolvedValue({
      ok: true,
      data: { id: "program-1", programCode: "FSD-101" },
    });
    for (const ctx of [adminContext, superAdminContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      await expect(createProgramAction({}, baseFormData())).rejects.toThrow(
        "REDIRECT_CALLED",
      );
    }
    expect(createProgramRecord).toHaveBeenCalledTimes(2);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "program.create",
        entityId: "program-1",
        after: { programCode: "FSD-101" },
      }),
    );
  });

  it("rejects a missing program name/code/regular fee with field errors, never checking duplicates", async () => {
    const result = await createProgramAction(
      {},
      baseFormData({ programCode: "", name: "", regularFee: "" }),
    );
    expect(result.fieldErrors?.programCode?.[0]).toMatch(/required/i);
    expect(result.fieldErrors?.name?.[0]).toMatch(/required/i);
    expect(result.fieldErrors?.regularFee?.[0]).toMatch(/required/i);
    expect(findProgramByExactCode).not.toHaveBeenCalled();
    expect(createProgramRecord).not.toHaveBeenCalled();
  });

  it("blocks a code that does not match the configured company_settings.program_code_pattern", async () => {
    vi.mocked(getProgramCodePattern).mockResolvedValue({
      ok: true,
      data: "^[A-Z]{2,4}-\\d{3,4}$",
    });

    const result = await createProgramAction(
      {},
      baseFormData({ programCode: "not-a-valid-code" }),
    );

    expect(result.fieldErrors?.programCode?.[0]).toMatch(/format/i);
    expect(findProgramByExactCode).not.toHaveBeenCalled();
    expect(createProgramRecord).not.toHaveBeenCalled();
  });

  it("ignores an invalid/malformed configured pattern rather than blocking every submission", async () => {
    vi.mocked(getProgramCodePattern).mockResolvedValue({ ok: true, data: "([A-Z" });
    vi.mocked(createProgramRecord).mockResolvedValue({
      ok: true,
      data: { id: "program-1", programCode: "FSD-101" },
    });

    await expect(createProgramAction({}, baseFormData())).rejects.toThrow(
      "REDIRECT_CALLED",
    );
    expect(createProgramRecord).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed pattern lookup as a visible error rather than silently creating", async () => {
    vi.mocked(getProgramCodePattern).mockResolvedValue({
      ok: false,
      error: "Could not load program code format settings.",
    });
    const result = await createProgramAction({}, baseFormData());
    expect(result.formError).toBe("Could not load program code format settings.");
    expect(createProgramRecord).not.toHaveBeenCalled();
  });

  it("surfaces a failed duplicate-code check as a visible error rather than silently creating", async () => {
    vi.mocked(findProgramByExactCode).mockResolvedValue({
      ok: false,
      error: "Could not check for a duplicate program code.",
    });
    const result = await createProgramAction({}, baseFormData());
    expect(result.formError).toBe("Could not check for a duplicate program code.");
    expect(createProgramRecord).not.toHaveBeenCalled();
  });

  it("hard-blocks a duplicate program code with a visible field error and never creates", async () => {
    vi.mocked(findProgramByExactCode).mockResolvedValue({
      ok: true,
      data: { id: "existing-1", name: "Existing Program" },
    });

    const result = await createProgramAction({}, baseFormData());

    expect(result.fieldErrors?.programCode?.[0]).toMatch(
      /already used by "Existing Program"/,
    );
    expect(createProgramRecord).not.toHaveBeenCalled();
  });

  it("surfaces a create failure (e.g. a race-condition unique_violation) as a visible error", async () => {
    vi.mocked(createProgramRecord).mockResolvedValue({
      ok: false,
      error: "This program code is already in use. Choose a different code.",
    });
    const result = await createProgramAction({}, baseFormData());
    expect(result.formError).toBe(
      "This program code is already in use. Choose a different code.",
    );
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("updateProgramAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(getProgramProfile).mockResolvedValue({
      ok: true,
      data: {
        id: "program-1",
        programCode: "FSD-101",
        name: "Full Stack Development",
        description: null,
        category: null,
        durationValue: null,
        durationUnit: null,
        deliveryMode: null,
        regularFee: "50000",
        registrationFee: "0",
        taxRatePercent: null,
        status: "draft",
        certificateEligible: true,
        installmentsAllowed: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    vi.mocked(updateProgramProfile).mockResolvedValue({ ok: true, data: null });
  });

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await updateProgramAction("program-1", {}, baseFormData());
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(updateProgramProfile).not.toHaveBeenCalled();
  });

  it("never audits program_code as a changed field, even when a tampered form submits a different one", async () => {
    // program_code immutability itself is enforced inside
    // updateProgramProfile (lib/data/programs.ts), which is mocked here —
    // see lib/data/__tests__/programs.test.ts for that guarantee. What this
    // action must never do is treat a submitted programCode as part of the
    // audited diff, regardless of what a tampered form includes.
    await expect(
      updateProgramAction(
        "program-1",
        {},
        baseFormData({
          programCode: "TAMPERED-999",
          name: "Updated Name",
          certificateEligible: "on",
          installmentsAllowed: "on",
        }),
      ),
    ).rejects.toThrow("REDIRECT_CALLED");

    const call = vi.mocked(writeAuditLog).mock.calls[0][0];
    expect(call.after).toEqual({ changedFields: ["name"] });
  });

  it("audits only the changed field names, not full before/after values", async () => {
    await expect(
      updateProgramAction(
        "program-1",
        {},
        baseFormData({
          name: "Updated Name",
          regularFee: "60000",
          certificateEligible: "on",
          installmentsAllowed: "on",
        }),
      ),
    ).rejects.toThrow("REDIRECT_CALLED");

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "program.update",
        entityId: "program-1",
        after: { changedFields: expect.arrayContaining(["name", "regularFee"]) },
      }),
    );
    const call = vi.mocked(writeAuditLog).mock.calls[0][0];
    expect(call.after).toEqual({ changedFields: ["name", "regularFee"] });
  });

  it("surfaces a save failure as a visible error", async () => {
    vi.mocked(updateProgramProfile).mockResolvedValue({
      ok: false,
      error: "Could not save changes. Please try again.",
    });
    const result = await updateProgramAction("program-1", {}, baseFormData());
    expect(result.formError).toBe("Could not save changes. Please try again.");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("setProgramStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(getProgramProfile).mockResolvedValue({
      ok: true,
      data: {
        id: "program-1",
        programCode: "FSD-101",
        name: "Full Stack Development",
        description: null,
        category: null,
        durationValue: null,
        durationUnit: null,
        deliveryMode: null,
        regularFee: "50000",
        registrationFee: "0",
        taxRatePercent: null,
        status: "draft",
        certificateEligible: true,
        installmentsAllowed: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    vi.mocked(updateProgramStatus).mockResolvedValue({ ok: true, data: null });
  });

  it("rejects Trainer and Student", async () => {
    const formData = new FormData();
    formData.set("status", "active");
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await setProgramStatusAction("program-1", {}, formData);
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(updateProgramStatus).not.toHaveBeenCalled();
  });

  it("accepts every schema-supported status and audits before/after", async () => {
    for (const status of ["draft", "active", "inactive", "archived"]) {
      vi.mocked(updateProgramStatus).mockClear();
      vi.mocked(writeAuditLog).mockClear();
      const formData = new FormData();
      formData.set("status", status);
      const result = await setProgramStatusAction("program-1", {}, formData);
      expect(result.success).toBe(true);
      expect(updateProgramStatus).toHaveBeenCalledWith("program-1", status);
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "program.status_change",
          before: { status: "draft" },
          after: { status },
        }),
      );
    }
  });

  it("rejects a status value outside the schema's CHECK constraint", async () => {
    const formData = new FormData();
    formData.set("status", "suspended");
    const result = await setProgramStatusAction("program-1", {}, formData);
    expect(result.fieldErrors?.status).toBeTruthy();
    expect(updateProgramStatus).not.toHaveBeenCalled();
  });
});
