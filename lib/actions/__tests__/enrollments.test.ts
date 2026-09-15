import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mirrors lib/actions/__tests__/batches.test.ts's pattern: mock only the
 * true I/O boundary (lib/data/enrollments.ts, lib/auth/session.ts,
 * lib/data/audit-log.ts) so this exercises the real createEnrollmentAction/
 * setEnrollmentStatusAction and the real enrollmentCreateSchema/
 * enrollmentStatusSchema they call into, without a database.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/enrollments", () => ({
  createEnrollmentRecord: vi.fn(),
  getEnrollmentProfile: vi.fn(),
  updateEnrollmentStatus: vi.fn(),
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
  createEnrollmentAction,
  setEnrollmentStatusAction,
} from "@/lib/actions/enrollments";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  createEnrollmentRecord,
  getEnrollmentProfile,
  updateEnrollmentStatus,
} from "@/lib/data/enrollments";
import { writeAuditLog } from "@/lib/data/audit-log";

const VALID_STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_PROGRAM_ID = "22222222-2222-4222-8222-222222222222";

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
    studentId: VALID_STUDENT_ID,
    programId: VALID_PROGRAM_ID,
    batchId: "",
    regularFee: "50000",
    agreedFee: "45000",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("createEnrollmentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(createEnrollmentRecord).mockResolvedValue({
      ok: true,
      data: { id: "enr-1", enrollmentCode: "ENR-000001" },
    });
  });

  it("rejects Trainer and Student before ever creating a record", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await createEnrollmentAction({}, baseFormData());
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(createEnrollmentRecord).not.toHaveBeenCalled();
  });

  it("rejects anonymous (no session) before ever creating a record", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(null);
    const result = await createEnrollmentAction({}, baseFormData());
    expect(result.formError).toBe("You are not authorized to perform this action.");
    expect(createEnrollmentRecord).not.toHaveBeenCalled();
  });

  it("allows Admin and Super Admin, and redirects to the new enrollment's detail page", async () => {
    for (const ctx of [adminContext, superAdminContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      await expect(createEnrollmentAction({}, baseFormData())).rejects.toThrow(
        "REDIRECT_CALLED",
      );
    }
    expect(createEnrollmentRecord).toHaveBeenCalledTimes(2);
  });

  it("rejects a missing/invalid student, program, or fee with field errors, never creating a record", async () => {
    const result = await createEnrollmentAction(
      {},
      baseFormData({ studentId: "", programId: "", regularFee: "", agreedFee: "" }),
    );
    expect(result.fieldErrors?.studentId).toBeTruthy();
    expect(result.fieldErrors?.programId).toBeTruthy();
    expect(result.fieldErrors?.regularFee).toBeTruthy();
    expect(result.fieldErrors?.agreedFee).toBeTruthy();
    expect(createEnrollmentRecord).not.toHaveBeenCalled();
  });

  it("surfaces a create failure (e.g. Program/Batch mismatch) as a visible error, without auditing", async () => {
    vi.mocked(createEnrollmentRecord).mockResolvedValue({
      ok: false,
      error: "The selected batch does not belong to the selected program.",
    });
    const result = await createEnrollmentAction({}, baseFormData());
    expect(result.formError).toBe(
      "The selected batch does not belong to the selected program.",
    );
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a positive discount amount with a blank discount reason, never creating a record or auditing", async () => {
    const result = await createEnrollmentAction(
      {},
      baseFormData({ discountAmount: "5000", discountReason: "" }),
    );
    expect(result.fieldErrors?.discountReason).toContain(
      "Please enter a reason for the discount.",
    );
    expect(createEnrollmentRecord).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a positive discount amount with a whitespace-only discount reason, never creating a record or auditing", async () => {
    const result = await createEnrollmentAction(
      {},
      baseFormData({ discountAmount: "5000", discountReason: "   " }),
    );
    expect(result.fieldErrors?.discountReason).toContain(
      "Please enter a reason for the discount.",
    );
    expect(createEnrollmentRecord).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("creates a record when a positive discount amount has a valid discount reason", async () => {
    await expect(
      createEnrollmentAction(
        {},
        baseFormData({ discountAmount: "5000", discountReason: "Early Bird" }),
      ),
    ).rejects.toThrow("REDIRECT_CALLED");
    expect(createEnrollmentRecord).toHaveBeenCalledWith(
      expect.objectContaining({ discountAmount: "5000", discountReason: "Early Bird" }),
    );
  });

  it('forces tax_amount to "0" even when the submitted form data carries a non-zero value — the server never trusts a browser-supplied tax', async () => {
    await expect(
      createEnrollmentAction({}, baseFormData({ taxAmount: "9999" })),
    ).rejects.toThrow("REDIRECT_CALLED");
    expect(createEnrollmentRecord).toHaveBeenCalledWith(
      expect.objectContaining({ taxAmount: "0" }),
    );
  });

  // (25)/(26) A duplicate Student+Batch is rejected by the data layer
  // (lib/data/__tests__/enrollments.test.ts); this proves the action
  // surfaces that specific rejection without ever auditing a success —
  // the same fail-fast wiring already covered generically above
  // ("surfaces a create failure ... without auditing"), named explicitly
  // for this scenario per the Phase 9 report's required test list.
  it("surfaces a duplicate Student+Batch rejection as a visible error, creating no record and auditing nothing", async () => {
    vi.mocked(createEnrollmentRecord).mockResolvedValue({
      ok: false,
      error: "This student already has an enrollment for the selected batch.",
    });
    const result = await createEnrollmentAction({}, baseFormData());
    expect(result.formError).toBe(
      "This student already has an enrollment for the selected batch.",
    );
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("audits create with minimal metadata only — no financial fields, no full Student object", async () => {
    await expect(createEnrollmentAction({}, baseFormData())).rejects.toThrow(
      "REDIRECT_CALLED",
    );

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "enrollment.create",
        entityId: "enr-1",
        after: {
          studentId: VALID_STUDENT_ID,
          programId: VALID_PROGRAM_ID,
          batchId: null,
        },
      }),
    );
  });
});

describe("setEnrollmentStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(getEnrollmentProfile).mockResolvedValue({
      ok: true,
      data: {
        id: "enr-1",
        enrollmentCode: "ENR-000001",
        studentId: VALID_STUDENT_ID,
        studentCode: "STU-10001",
        studentName: "Asha Rao",
        programId: VALID_PROGRAM_ID,
        programName: "Full Stack Development",
        programCode: "FSD-101",
        batchId: null,
        batchName: null,
        enrollmentDate: "2026-09-01",
        status: "lead",
        regularFee: "50000",
        agreedFee: "45000",
        discountAmount: "0",
        discountReason: null,
        registrationFee: "0",
        taxAmount: "0",
        totalPayable: "45000",
        paymentPlanType: null,
        source: null,
        notes: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    vi.mocked(updateEnrollmentStatus).mockResolvedValue({ ok: true, data: null });
  });

  it("rejects Trainer and Student", async () => {
    const formData = new FormData();
    formData.set("status", "active");
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await setEnrollmentStatusAction("enr-1", {}, formData);
      expect(result.formError).toBe("You are not authorized to perform this action.");
    }
    expect(updateEnrollmentStatus).not.toHaveBeenCalled();
  });

  it("allows Admin and Super Admin to change status", async () => {
    const formData = new FormData();
    formData.set("status", "active");
    for (const ctx of [adminContext, superAdminContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await setEnrollmentStatusAction("enr-1", {}, formData);
      expect(result.success).toBe(true);
    }
  });

  it("rejects an invented status value", async () => {
    const formData = new FormData();
    formData.set("status", "hold");
    const result = await setEnrollmentStatusAction("enr-1", {}, formData);
    expect(result.fieldErrors?.status).toBeTruthy();
    expect(updateEnrollmentStatus).not.toHaveBeenCalled();
  });

  // Manual-acceptance correction (Sept 2026): "registered" was removed —
  // no longer a selectable status value.
  it("rejects the removed 'registered' status value", async () => {
    const formData = new FormData();
    formData.set("status", "registered");
    const result = await setEnrollmentStatusAction("enr-1", {}, formData);
    expect(result.fieldErrors?.status).toBeTruthy();
    expect(updateEnrollmentStatus).not.toHaveBeenCalled();
  });

  // (16) An operational status change is rejected server-side when the
  // Enrollment has no Batch — surfaced here as the visible formError this
  // action already forwards from the data layer.
  it("surfaces a batch-required rejection as a visible error, without auditing", async () => {
    vi.mocked(updateEnrollmentStatus).mockResolvedValue({
      ok: false,
      error: "A batch must be assigned before this enrollment can use this status.",
    });
    const formData = new FormData();
    formData.set("status", "active");
    const result = await setEnrollmentStatusAction("enr-1", {}, formData);
    expect(result.formError).toBe(
      "A batch must be assigned before this enrollment can use this status.",
    );
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("audits the status change with before/after status only", async () => {
    const formData = new FormData();
    formData.set("status", "active");
    await setEnrollmentStatusAction("enr-1", {}, formData);

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "enrollment.status_change",
        entityId: "enr-1",
        before: { status: "lead" },
        after: { status: "active" },
      }),
    );
  });

  it("surfaces a status-update failure as a visible error, without auditing", async () => {
    vi.mocked(updateEnrollmentStatus).mockResolvedValue({
      ok: false,
      error: "Could not update the enrollment's status. Please try again.",
    });
    const formData = new FormData();
    formData.set("status", "active");
    const result = await setEnrollmentStatusAction("enr-1", {}, formData);
    expect(result.formError).toBe(
      "Could not update the enrollment's status. Please try again.",
    );
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
