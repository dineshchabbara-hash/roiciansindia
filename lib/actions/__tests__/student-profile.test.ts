import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mirrors lib/actions/__tests__/enrollments.test.ts's pattern: mock only
 * the true I/O boundary (lib/data/student-portal.ts, lib/auth/session.ts,
 * lib/data/audit-log.ts) so this exercises the real updateMyProfileAction
 * and the real studentSelfProfileSchema it calls into, without a database.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/student-portal", () => ({
  getMyStudentProfile: vi.fn(),
  updateMyStudentProfile: vi.fn(),
}));

vi.mock("@/lib/data/audit-log", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { updateMyProfileAction } from "@/lib/actions/student-profile";
import { getCurrentUserContext } from "@/lib/auth/session";
import { getMyStudentProfile, updateMyStudentProfile } from "@/lib/data/student-portal";
import { writeAuditLog } from "@/lib/data/audit-log";

const studentContext = {
  authUserId: "student-auth-1",
  email: "asha@example.com",
  role: "student" as const,
  profileId: "student-profile-1",
  displayName: "Asha Rao",
};

function validFormData(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const fields = {
    phoneCountry: "IN",
    phone: "9898595069",
    alternatePhone: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

describe("updateMyProfileAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when there is no authenticated user", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(null);

    const result = await updateMyProfileAction({}, validFormData());

    expect(result).toEqual({
      formError: "You are not authorized to perform this action.",
    });
    expect(updateMyStudentProfile).not.toHaveBeenCalled();
  });

  it("rejects a non-student role even if somehow invoked (defense in depth beyond the route layout)", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue({
      ...studentContext,
      role: "admin",
    });

    const result = await updateMyProfileAction({}, validFormData());

    expect(result).toEqual({
      formError: "You are not authorized to perform this action.",
    });
    expect(updateMyStudentProfile).not.toHaveBeenCalled();
  });

  it("returns field errors for an invalid phone without calling the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(studentContext);

    const result = await updateMyProfileAction({}, validFormData({ phone: "123" }));

    expect(result.fieldErrors?.phone?.[0]).toBe(
      "Enter a valid phone number for the selected country.",
    );
    expect(updateMyStudentProfile).not.toHaveBeenCalled();
  });

  it("saves only the FR-41 self-service fields and reports success", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(studentContext);
    vi.mocked(getMyStudentProfile).mockResolvedValue({
      ok: true,
      data: {
        id: "student-profile-1",
        studentCode: "STU-000001",
        firstName: "Asha",
        lastName: "Rao",
        preferredName: null,
        email: "asha@example.com",
        phone: "+910000000000",
        alternatePhone: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        registrationDate: "2026-01-01",
        status: "active",
      },
    });
    vi.mocked(updateMyStudentProfile).mockResolvedValue({ ok: true, data: null });

    const result = await updateMyProfileAction(
      {},
      validFormData({ addressLine1: "221B Baker Street", city: "Mumbai" }),
    );

    expect(result).toEqual({ success: true });
    expect(updateMyStudentProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+919898595069",
        addressLine1: "221B Baker Street",
        city: "Mumbai",
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorAuthUserId: "student-auth-1",
        actorRole: "student",
        action: "student.self_update",
        entityType: "student",
        entityId: "student-profile-1",
      }),
    );
  });

  it("surfaces a data-layer failure as a form error", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(studentContext);
    vi.mocked(getMyStudentProfile).mockResolvedValue({
      ok: false,
      error: "Could not load your profile.",
    });
    vi.mocked(updateMyStudentProfile).mockResolvedValue({
      ok: false,
      error: "Could not save changes. Please try again.",
    });

    const result = await updateMyProfileAction({}, validFormData());

    expect(result.formError).toBe("Could not save changes. Please try again.");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
