import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * lib/data/trainers.ts, lib/auth/session.ts, and lib/data/audit-log.ts are
 * all server-only and touch Supabase — mocked here so this test exercises
 * the real createTrainerAction/updateTrainerAction/setTrainerStatusAction
 * (and the real trainerProfileSchema they call into) without a database.
 * Mirrors lib/actions/__tests__/students.test.ts's pattern.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/trainers", () => ({
  findDuplicateTrainers: vi.fn(),
  createTrainerRecord: vi.fn(),
  getTrainerProfile: vi.fn(),
  updateTrainerProfile: vi.fn(),
  updateTrainerStatus: vi.fn(),
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
  createTrainerAction,
  updateTrainerAction,
  setTrainerStatusAction,
} from "@/lib/actions/trainers";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  findDuplicateTrainers,
  createTrainerRecord,
  getTrainerProfile,
  updateTrainerProfile,
  updateTrainerStatus,
} from "@/lib/data/trainers";
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
    firstName: "Test",
    lastName: "Trainer",
    email: "test.trainer@example.com",
    phoneCountry: "IN",
    phone: "9898595069",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("createTrainerAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(findDuplicateTrainers).mockResolvedValue({ ok: true, data: [] });
  });

  it("rejects Trainer and Student before ever checking for duplicates or creating a record", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await createTrainerAction({}, baseFormData());
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(findDuplicateTrainers).not.toHaveBeenCalled();
    expect(createTrainerRecord).not.toHaveBeenCalled();
  });

  it("allows Admin and Super Admin", async () => {
    vi.mocked(createTrainerRecord).mockResolvedValue({
      ok: true,
      data: { id: "trainer-1" },
    });
    for (const ctx of [adminContext, superAdminContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      await expect(createTrainerAction({}, baseFormData())).rejects.toThrow(
        "REDIRECT_CALLED",
      );
    }
    expect(createTrainerRecord).toHaveBeenCalledTimes(2);
  });

  it("rejects a tampered country code before ever checking for duplicates", async () => {
    const result = await createTrainerAction({}, baseFormData({ phoneCountry: "ZZ" }));
    expect(result.fieldErrors?.phoneCountry?.[0]).toMatch(/valid country/i);
    expect(findDuplicateTrainers).not.toHaveBeenCalled();
    expect(createTrainerRecord).not.toHaveBeenCalled();
  });

  it("surfaces a failed duplicate check as a visible error rather than silently creating", async () => {
    vi.mocked(findDuplicateTrainers).mockResolvedValue({
      ok: false,
      error: "Could not check for duplicate trainers. Please try again.",
    });
    const result = await createTrainerAction({}, baseFormData());
    expect(result.formError).toBe(
      "Could not check for duplicate trainers. Please try again.",
    );
    expect(createTrainerRecord).not.toHaveBeenCalled();
  });

  it("returns the duplicate list instead of creating when a phone-only match is found and not overridden", async () => {
    vi.mocked(findDuplicateTrainers).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "existing-1",
            firstName: "Existing",
            lastName: "Trainer",
            email: "someone.else@example.com",
            phone: "+919898595069",
          },
          reasons: ["phone"],
        },
      ],
    });

    const result = await createTrainerAction({}, baseFormData());

    expect(result.duplicates).toEqual([
      {
        trainerId: "existing-1",
        name: "Existing Trainer",
        reasons: ["phone"],
        reasonLabels: ["Same phone number"],
      },
    ]);
    expect(createTrainerRecord).not.toHaveBeenCalled();
  });

  it("requires a reason when confirming a phone-only override, even with a real duplicate pending", async () => {
    vi.mocked(findDuplicateTrainers).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "existing-1",
            firstName: "Existing",
            lastName: "Trainer",
            email: "someone.else@example.com",
            phone: "+919898595069",
          },
          reasons: ["phone"],
        },
      ],
    });

    const result = await createTrainerAction({}, baseFormData({ confirmOverride: "on" }));

    expect(result.fieldErrors?.overrideReason).toBeTruthy();
    expect(createTrainerRecord).not.toHaveBeenCalled();
  });

  it("creates and audits the override once a phone-only duplicate is confirmed with a valid reason", async () => {
    vi.mocked(findDuplicateTrainers).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "existing-1",
            firstName: "Existing",
            lastName: "Trainer",
            email: "someone.else@example.com",
            phone: "+919898595069",
          },
          reasons: ["phone"],
        },
      ],
    });
    vi.mocked(createTrainerRecord).mockResolvedValue({
      ok: true,
      data: { id: "new-trainer-1" },
    });

    const formData = baseFormData({
      confirmOverride: "on",
      overrideReason: "Coincidentally shares a family phone number.",
    });

    await expect(createTrainerAction({}, formData)).rejects.toThrow("REDIRECT_CALLED");

    expect(createTrainerRecord).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "trainer.create" }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "trainer.duplicate_override_confirmed",
        after: expect.objectContaining({
          reason: "Coincidentally shares a family phone number.",
          matchedRules: ["phone"],
        }),
      }),
    );
  });

  it("hard-blocks a duplicate email with a visible field error, never calling createTrainerRecord, and never shows a duplicates list", async () => {
    vi.mocked(findDuplicateTrainers).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "existing-1",
            firstName: "Existing",
            lastName: "Trainer",
            email: "test.trainer@example.com",
            phone: null,
          },
          reasons: ["email"],
        },
      ],
    });

    const result = await createTrainerAction({}, baseFormData());

    expect(result.fieldErrors?.email?.[0]).toBe(
      "This email is already registered to another trainer/account. Please use a different email address.",
    );
    expect(result.duplicates).toBeUndefined();
    expect(createTrainerRecord).not.toHaveBeenCalled();
  });

  it("cannot bypass the email hard block with a crafted confirmOverride=on and a reason in the FormData", async () => {
    vi.mocked(findDuplicateTrainers).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "existing-1",
            firstName: "Existing",
            lastName: "Trainer",
            email: "test.trainer@example.com",
            phone: null,
          },
          reasons: ["email"],
        },
      ],
    });

    const result = await createTrainerAction(
      {},
      baseFormData({
        confirmOverride: "on",
        overrideReason: "This is definitely a different person, trust me.",
      }),
    );

    expect(result.fieldErrors?.email?.[0]).toMatch(/already registered/i);
    expect(createTrainerRecord).not.toHaveBeenCalled();
  });

  it("blocks creation when a single candidate matches on both email and phone — email precedence, phone override cannot bypass it", async () => {
    vi.mocked(findDuplicateTrainers).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "existing-1",
            firstName: "Existing",
            lastName: "Trainer",
            email: "test.trainer@example.com",
            phone: "+919898595069",
          },
          reasons: ["phone", "email"],
        },
      ],
    });

    const result = await createTrainerAction(
      {},
      baseFormData({ confirmOverride: "on", overrideReason: "Same household." }),
    );

    expect(result.fieldErrors?.email?.[0]).toMatch(/already registered/i);
    expect(createTrainerRecord).not.toHaveBeenCalled();
  });

  it("blocks creation when different candidates separately match email and phone", async () => {
    vi.mocked(findDuplicateTrainers).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "email-match",
            firstName: "Email",
            lastName: "Match",
            email: "test.trainer@example.com",
            phone: null,
          },
          reasons: ["email"],
        },
        {
          candidate: {
            id: "phone-match",
            firstName: "Phone",
            lastName: "Match",
            email: "unrelated@example.com",
            phone: "+919898595069",
          },
          reasons: ["phone"],
        },
      ],
    });

    const result = await createTrainerAction({}, baseFormData());

    expect(result.fieldErrors?.email?.[0]).toMatch(/already registered/i);
    expect(result.duplicates).toBeUndefined();
    expect(createTrainerRecord).not.toHaveBeenCalled();
  });

  it("surfaces an account-creation failure (e.g. email already registered under another role) as a visible error", async () => {
    vi.mocked(createTrainerRecord).mockResolvedValue({
      ok: false,
      error: "This email is already registered to another account.",
    });
    const result = await createTrainerAction({}, baseFormData());
    expect(result.formError).toBe("This email is already registered to another account.");
  });
});

describe("updateTrainerAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
  });

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await updateTrainerAction("trainer-1", {}, baseFormData());
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(updateTrainerProfile).not.toHaveBeenCalled();
  });

  it("computes only the changed field names for the audit entry, not full before/after records", async () => {
    vi.mocked(getTrainerProfile).mockResolvedValue({
      ok: true,
      data: {
        id: "trainer-1",
        authUserId: "auth-1",
        firstName: "Old",
        lastName: "Trainer",
        email: "test.trainer@example.com",
        phone: "+919898595069",
        bio: null,
        specialization: [],
        status: "active",
        createdAt: "2026-01-01T00:00:00Z",
      },
    });
    vi.mocked(updateTrainerProfile).mockResolvedValue({ ok: true, data: null });

    await expect(
      updateTrainerAction("trainer-1", {}, baseFormData({ firstName: "New" })),
    ).rejects.toThrow("REDIRECT_CALLED");

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "trainer.update",
        after: { changedFields: ["firstName"] },
      }),
    );
  });

  it("surfaces a save failure as a visible formError", async () => {
    vi.mocked(getTrainerProfile).mockResolvedValue({ ok: false, error: "not found" });
    vi.mocked(updateTrainerProfile).mockResolvedValue({
      ok: false,
      error: "Could not save changes. Please try again.",
    });

    const result = await updateTrainerAction("trainer-1", {}, baseFormData());
    expect(result.formError).toBe("Could not save changes. Please try again.");
  });
});

describe("setTrainerStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
  });

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const formData = new FormData();
      formData.set("status", "inactive");
      const result = await setTrainerStatusAction("trainer-1", {}, formData);
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(updateTrainerStatus).not.toHaveBeenCalled();
  });

  it("rejects an unsupported status value (e.g. 'archived', which trainers don't have)", async () => {
    const formData = new FormData();
    formData.set("status", "archived");
    const result = await setTrainerStatusAction("trainer-1", {}, formData);
    expect(result.fieldErrors?.status).toBeTruthy();
    expect(updateTrainerStatus).not.toHaveBeenCalled();
  });

  it("updates status, audits before/after, and succeeds for Admin", async () => {
    vi.mocked(getTrainerProfile).mockResolvedValue({
      ok: true,
      data: {
        id: "trainer-1",
        authUserId: "auth-1",
        firstName: "Test",
        lastName: "Trainer",
        email: "test.trainer@example.com",
        phone: null,
        bio: null,
        specialization: [],
        status: "active",
        createdAt: "2026-01-01T00:00:00Z",
      },
    });
    vi.mocked(updateTrainerStatus).mockResolvedValue({ ok: true, data: null });

    const formData = new FormData();
    formData.set("status", "inactive");
    const result = await setTrainerStatusAction("trainer-1", {}, formData);

    expect(result.success).toBe(true);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "trainer.status_change",
        before: { status: "active" },
        after: { status: "inactive" },
      }),
    );
  });

  it("succeeds for Super Admin too", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(superAdminContext);
    vi.mocked(getTrainerProfile).mockResolvedValue({ ok: false, error: "n/a" });
    vi.mocked(updateTrainerStatus).mockResolvedValue({ ok: true, data: null });

    const formData = new FormData();
    formData.set("status", "active");
    const result = await setTrainerStatusAction("trainer-1", {}, formData);
    expect(result.success).toBe(true);
  });
});
