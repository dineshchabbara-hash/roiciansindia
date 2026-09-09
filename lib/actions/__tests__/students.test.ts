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

import {
  createStudentAction,
  uploadStudentDocumentAction,
  deleteStudentDocumentAction,
} from "@/lib/actions/students";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  findDuplicateStudents,
  createStudentRecord,
  uploadStudentDocument,
  deleteStudentDocument,
} from "@/lib/data/students";
import { writeAuditLog } from "@/lib/data/audit-log";
import { revalidatePath } from "next/cache";

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

function fileFormData(file: File | null, documentType: string | null): FormData {
  const formData = new FormData();
  if (file) formData.set("file", file);
  if (documentType !== null) formData.set("documentType", documentType);
  return formData;
}

describe("uploadStudentDocumentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects Trainer and Student without ever touching storage", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await uploadStudentDocumentAction(
        "student-1",
        {},
        fileFormData(new File(["x"], "id.pdf"), "ID proof"),
      );
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(uploadStudentDocument).not.toHaveBeenCalled();
  });

  it("returns a visible field error, never a silent failure, when no file is chosen", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    const result = await uploadStudentDocumentAction(
      "student-1",
      {},
      fileFormData(null, "ID proof"),
    );
    expect(result.fieldErrors?.file?.[0]).toBeTruthy();
    expect(uploadStudentDocument).not.toHaveBeenCalled();
  });

  it("rejects an oversized file with a visible field error and never calls uploadStudentDocument", async () => {
    // Real Phase 5 bug: nothing validated file size before this fix, so a
    // real-world file could reach (and be rejected by) Next's own Server
    // Action body-size transport limit, crashing the page instead of
    // showing this exact kind of controlled error. The client-side check
    // in StudentDocumentsSection blocks this before it's ever submitted,
    // but the server must never trust that alone (same posture as every
    // other server-side check in this file) — a request that bypassed the
    // form entirely must still be rejected here.
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    const oversizedFile = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(oversizedFile, "size", { value: 20_000_000 });

    const result = await uploadStudentDocumentAction(
      "student-1",
      {},
      fileFormData(oversizedFile, "ID proof"),
    );

    expect(result.fieldErrors?.file?.[0]).toMatch(/too large/i);
    expect(uploadStudentDocument).not.toHaveBeenCalled();
  });

  it("uploads, audits metadata only (never file contents), and revalidates the profile for Admin", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(uploadStudentDocument).mockResolvedValue({
      ok: true,
      data: { id: "doc-1" },
    });

    const result = await uploadStudentDocumentAction(
      "student-1",
      {},
      fileFormData(new File(["secret contents"], "id.pdf"), "ID proof"),
    );

    expect(result.success).toBe(true);
    expect(uploadStudentDocument).toHaveBeenCalledWith(
      "student-1",
      "ID proof",
      expect.any(File),
      adminContext.profileId,
    );
    const auditCall = vi
      .mocked(writeAuditLog)
      .mock.calls.find(([entry]) => entry.action === "student.document.upload");
    expect(auditCall).toBeTruthy();
    expect(JSON.stringify(auditCall![0])).not.toContain("secret contents");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/students/student-1");
  });

  it("succeeds for Super Admin too", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(superAdminContext);
    vi.mocked(uploadStudentDocument).mockResolvedValue({
      ok: true,
      data: { id: "doc-2" },
    });

    const result = await uploadStudentDocumentAction(
      "student-1",
      {},
      fileFormData(new File(["x"], "id.pdf"), "ID proof"),
    );
    expect(result.success).toBe(true);
  });

  it("surfaces a storage/data-layer failure as a visible formError, not a silent no-op", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(uploadStudentDocument).mockResolvedValue({
      ok: false,
      error: "Could not upload the document. Please try again.",
    });

    const result = await uploadStudentDocumentAction(
      "student-1",
      {},
      fileFormData(new File(["x"], "id.pdf"), "ID proof"),
    );
    expect(result.formError).toBe("Could not upload the document. Please try again.");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("deleteStudentDocumentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects Trainer and Student without ever touching storage", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await deleteStudentDocumentAction("student-1", "doc-1");
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(deleteStudentDocument).not.toHaveBeenCalled();
  });

  it("deletes (removing both the Storage object and the metadata row via the data layer), audits, and revalidates for Admin", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(deleteStudentDocument).mockResolvedValue({ ok: true, data: null });

    const result = await deleteStudentDocumentAction("student-1", "doc-1");

    expect(result.success).toBe(true);
    expect(deleteStudentDocument).toHaveBeenCalledWith("student-1", "doc-1");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "student.document.delete",
        entityType: "student_document",
        entityId: "doc-1",
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/students/student-1");
  });

  it("succeeds for Super Admin too", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(superAdminContext);
    vi.mocked(deleteStudentDocument).mockResolvedValue({ ok: true, data: null });

    const result = await deleteStudentDocumentAction("student-1", "doc-1");
    expect(result.success).toBe(true);
  });

  it("surfaces a data-layer failure (e.g. ownership mismatch) as a visible formError, not a silent no-op", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(deleteStudentDocument).mockResolvedValue({
      ok: false,
      error: "Document not found.",
    });

    const result = await deleteStudentDocumentAction("student-1", "doc-1");
    expect(result.formError).toBe("Document not found.");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
