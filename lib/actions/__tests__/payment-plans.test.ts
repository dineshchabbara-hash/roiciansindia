import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mirrors lib/actions/__tests__/enrollments.test.ts's pattern (not
 * attendance's — attendance's own action never calls the general
 * audit_logs system at all, since attendance has its own dedicated
 * attendance_audit table; Payment Plans use the general writeAuditLog, same
 * as Enrollment mutations): mock the true I/O boundary
 * (lib/data/payment-plans.ts, lib/auth/session.ts, lib/data/audit-log.ts)
 * so this exercises the real actions and the real
 * lib/validation/payment-plans.ts parsing they call into, without a
 * database.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/payment-plans", () => ({
  createPaymentPlanForEnrollment: vi.fn(),
  addInstallmentToPlan: vi.fn(),
  editInstallment: vi.fn(),
  waiveInstallment: vi.fn(),
  removeInstallment: vi.fn(),
}));

vi.mock("@/lib/data/audit-log", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  createPaymentPlanAction,
  addInstallmentAction,
  editInstallmentAction,
  waiveInstallmentAction,
  removeInstallmentAction,
} from "@/lib/actions/payment-plans";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  createPaymentPlanForEnrollment,
  addInstallmentToPlan,
  editInstallment,
  waiveInstallment,
  removeInstallment,
} from "@/lib/data/payment-plans";

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

function installmentLineFormData(fields: {
  label?: string;
  amount?: string;
  dueDate?: string;
}): FormData {
  const formData = new FormData();
  if (fields.label !== undefined) formData.set("label", fields.label);
  if (fields.amount !== undefined) formData.set("amount", fields.amount);
  if (fields.dueDate !== undefined) formData.set("dueDate", fields.dueDate);
  return formData;
}

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

describe("createPaymentPlanAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const formData = new FormData();
      formData.append("label", "Full payment");
      formData.append("amount", "30000.00");
      formData.append("dueDate", "2026-01-01");
      const result = await createPaymentPlanAction("enr-1", {}, formData);
      expect(result.formError).toBe(NOT_AUTHORIZED);
    }
    expect(createPaymentPlanForEnrollment).not.toHaveBeenCalled();
  });

  it("rejects an empty installments submission before reaching the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    const result = await createPaymentPlanAction("enr-1", {}, new FormData());
    expect(result.formError).toBeTruthy();
    expect(createPaymentPlanForEnrollment).not.toHaveBeenCalled();
  });

  it("allows Admin and calls the data layer with the parsed installments", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(createPaymentPlanForEnrollment).mockResolvedValue({
      ok: true,
      data: { id: "plan-1" },
    });

    const formData = new FormData();
    formData.append("label", "Registration");
    formData.append("amount", "10000.00");
    formData.append("dueDate", "2026-01-01");

    const result = await createPaymentPlanAction("enr-1", {}, formData);
    expect(result).toEqual({ success: true });
    expect(createPaymentPlanForEnrollment).toHaveBeenCalledWith("enr-1", {
      installments: [
        { label: "Registration", amount: "10000.00", dueDate: "2026-01-01" },
      ],
    });
  });

  it("surfaces a data-layer error as a visible formError", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(createPaymentPlanForEnrollment).mockResolvedValue({
      ok: false,
      error: "This enrollment already has a payment plan.",
    });

    const formData = new FormData();
    formData.append("label", "Full payment");
    formData.append("amount", "30000.00");
    formData.append("dueDate", "2026-01-01");

    const result = await createPaymentPlanAction("enr-1", {}, formData);
    expect(result).toEqual({ formError: "This enrollment already has a payment plan." });
  });
});

describe("addInstallmentAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await addInstallmentAction(
        "plan-1",
        "enr-1",
        {},
        installmentLineFormData({ amount: "5000.00", dueDate: "2026-01-01" }),
      );
      expect(result.formError).toBe(NOT_AUTHORIZED);
    }
    expect(addInstallmentToPlan).not.toHaveBeenCalled();
  });

  it("allows Admin and forwards the parsed line to the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(addInstallmentToPlan).mockResolvedValue({
      ok: true,
      data: { id: "inst-3" },
    });

    const result = await addInstallmentAction(
      "plan-1",
      "enr-1",
      {},
      installmentLineFormData({
        label: "Installment 3",
        amount: "5000.00",
        dueDate: "2026-04-01",
      }),
    );
    expect(result).toEqual({ success: true });
    expect(addInstallmentToPlan).toHaveBeenCalledWith("plan-1", {
      label: "Installment 3",
      amount: "5000.00",
      dueDate: "2026-04-01",
    });
  });
});

describe("editInstallmentAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await editInstallmentAction(
        "inst-1",
        "enr-1",
        {},
        installmentLineFormData({ amount: "5000.00", dueDate: "2026-01-01" }),
      );
      expect(result.formError).toBe(NOT_AUTHORIZED);
    }
    expect(editInstallment).not.toHaveBeenCalled();
  });

  it("surfaces the 'paid installment' guard from the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(editInstallment).mockResolvedValue({
      ok: false,
      error: "A fully paid installment cannot be edited.",
    });

    const result = await editInstallmentAction(
      "inst-1",
      "enr-1",
      {},
      installmentLineFormData({ amount: "5000.00", dueDate: "2026-01-01" }),
    );
    expect(result).toEqual({ formError: "A fully paid installment cannot be edited." });
  });
});

describe("waiveInstallmentAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await waiveInstallmentAction("inst-1", "enr-1", {}, new FormData());
      expect(result.formError).toBe(NOT_AUTHORIZED);
    }
    expect(waiveInstallment).not.toHaveBeenCalled();
  });

  it("allows Admin", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(waiveInstallment).mockResolvedValue({ ok: true, data: { id: "inst-1" } });

    const result = await waiveInstallmentAction("inst-1", "enr-1", {}, new FormData());
    expect(result).toEqual({ success: true });
    expect(waiveInstallment).toHaveBeenCalledWith("inst-1");
  });
});

describe("removeInstallmentAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Trainer and Student", async () => {
    for (const ctx of [trainerContext, studentContext]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await removeInstallmentAction("inst-1", "enr-1", {}, new FormData());
      expect(result.formError).toBe(NOT_AUTHORIZED);
    }
    expect(removeInstallment).not.toHaveBeenCalled();
  });

  it("surfaces the 'payment recorded' guard from the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(removeInstallment).mockResolvedValue({
      ok: false,
      error: "This installment has a payment recorded against it and cannot be removed.",
    });

    const result = await removeInstallmentAction("inst-1", "enr-1", {}, new FormData());
    expect(result).toEqual({
      formError:
        "This installment has a payment recorded against it and cannot be removed.",
    });
  });
});
