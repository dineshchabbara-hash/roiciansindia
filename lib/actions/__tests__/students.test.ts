import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * lib/data/students.ts, lib/auth/session.ts, and lib/data/audit-log.ts are
 * all `server-only` and touch Supabase — mocked here so this test exercises
 * the real createStudentAction (and the real studentProfileSchema it calls
 * into) without a database. lib/domain/students.ts and
 * lib/validation/students.ts are NOT mocked: the whole point of the
 * tampered-country-code test is to prove the real validation rejects it.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/students", () => ({
  findDuplicateStudents: vi.fn(),
  createStudentRecord: vi.fn(),
  updateStudentProfile: vi.fn(),
  updateStudentStatus: vi.fn(),
  insertStudentNote: vi.fn(),
  uploadStudentDocument: vi.fn(),
  deleteStudentDocument: vi.fn(),
  getStudentProfile: vi.fn(),
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

import { createStudentAction } from "@/lib/actions/students";
import { getCurrentUserContext } from "@/lib/auth/session";
import { findDuplicateStudents, createStudentRecord } from "@/lib/data/students";
import { writeAuditLog } from "@/lib/data/audit-log";

const adminContext = {
  authUserId: "admin-auth-1",
  email: "admin@example.com",
  role: "admin" as const,
  profileId: "admin-profile-1",
  displayName: "Test Admin",
};

function baseFormData(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  const fields: Record<string, string> = {
    firstName: "Test",
    lastName: "Student",
    phoneCountry: "IN",
    phone: "9898595069",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("createStudentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
  });

  it("rejects a tampered country code before ever checking for duplicates or creating a record", async () => {
    // "ZZ" cannot come from the rendered <select> — it only ever offers
    // real codes — so this simulates a request that bypassed the form
    // entirely. The server must not trust it just because the field name
    // matches what the form would have sent.
    const formData = baseFormData({ phoneCountry: "ZZ" });

    const result = await createStudentAction({}, formData);

    expect(result.fieldErrors?.phoneCountry?.[0]).toMatch(/valid country/i);
    // And the phone itself must not have been silently accepted as if a
    // default country had been assumed.
    expect(result.fieldErrors?.phone).toBeUndefined();
    expect(findDuplicateStudents).not.toHaveBeenCalled();
    expect(createStudentRecord).not.toHaveBeenCalled();
  });

  it("surfaces a failed duplicate check as a visible error rather than silently creating", async () => {
    vi.mocked(findDuplicateStudents).mockResolvedValue({
      ok: false,
      error: "Could not check for duplicate students. Please try again.",
    });

    const result = await createStudentAction({}, baseFormData());

    expect(result.formError).toBe(
      "Could not check for duplicate students. Please try again.",
    );
    expect(createStudentRecord).not.toHaveBeenCalled();
  });

  it("returns the duplicate list instead of creating when a match is found and not overridden", async () => {
    vi.mocked(findDuplicateStudents).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "existing-1",
            studentCode: "10001",
            firstName: "Existing",
            lastName: "Student",
            email: null,
            phone: "+919898595069",
            dateOfBirth: null,
          },
          reasons: ["phone"],
        },
      ],
    });

    const result = await createStudentAction({}, baseFormData());

    expect(result.duplicates).toEqual([
      {
        studentId: "existing-1",
        studentCode: "10001",
        name: "Existing Student",
        reasons: ["phone"],
        reasonLabels: ["Same phone number"],
      },
    ]);
    expect(createStudentRecord).not.toHaveBeenCalled();
  });

  it("requires a reason when confirming an override, even with a real duplicate pending", async () => {
    const formData = baseFormData({ confirmOverride: "on" });
    // No overrideReason set at all.

    const result = await createStudentAction({}, formData);

    expect(result.fieldErrors?.overrideReason).toBeTruthy();
    expect(createStudentRecord).not.toHaveBeenCalled();
  });

  it("creates and audits the override once confirmation and a valid reason are both present", async () => {
    vi.mocked(findDuplicateStudents).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "existing-1",
            studentCode: "10001",
            firstName: "Existing",
            lastName: "Student",
            email: null,
            phone: "+919898595069",
            dateOfBirth: null,
          },
          reasons: ["phone"],
        },
      ],
    });
    vi.mocked(createStudentRecord).mockResolvedValue({
      ok: true,
      data: { id: "new-student-1", studentCode: "10002" },
    });

    const formData = baseFormData({
      confirmOverride: "on",
      overrideReason: "Twin siblings, shared household phone number.",
    });

    await expect(createStudentAction({}, formData)).rejects.toThrow("REDIRECT_CALLED");

    expect(createStudentRecord).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "student.create" }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "student.duplicate_override_confirmed",
        after: expect.objectContaining({
          reason: "Twin siblings, shared household phone number.",
          matchedStudentCodes: ["10001"],
          matchedRules: ["phone"],
        }),
      }),
    );
  });
});
