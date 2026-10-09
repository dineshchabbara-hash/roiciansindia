import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Same pattern as lib/actions/__tests__/payment-plans.test.ts: mock the
 * true I/O boundary (session, lib/data/payments, audit log, next/cache,
 * next/navigation) so the real action and the real
 * lib/validation/payments.ts parsing run without a database.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/payments", () => ({
  recordOfflinePayment: vi.fn(),
}));

vi.mock("@/lib/data/audit-log", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { recordOfflinePaymentAction } from "@/lib/actions/payments";
import { getCurrentUserContext } from "@/lib/auth/session";
import { recordOfflinePayment } from "@/lib/data/payments";
import { writeAuditLog } from "@/lib/data/audit-log";
import { revalidatePath } from "next/cache";

const PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENROLLMENT_ID = "11111111-2222-4333-8444-555555555555";

function context(role: "admin" | "super_admin" | "trainer" | "student") {
  return {
    authUserId: `${role}-auth-1`,
    email: `${role}@example.com`,
    role,
    profileId: `${role}-profile-1`,
    displayName: `Test ${role}`,
  };
}

function validForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const values = {
    paymentId: PAYMENT_ID,
    enrollmentId: ENROLLMENT_ID,
    amount: "2500.50",
    method: "cash",
    paymentType: "partial",
    paidOn: "2026-10-09",
    reference: "Receipt book 4 / 17",
    notes: "Paid at the front desk",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordOfflinePaymentAction — authorization", () => {
  it.each([["trainer"], ["student"]] as const)(
    "refuses a %s before touching any data",
    async (role) => {
      vi.mocked(getCurrentUserContext).mockResolvedValue(context(role));
      const result = await recordOfflinePaymentAction({}, validForm());
      expect(result).toEqual({ formError: "You are not authorized to record payments." });
      expect(recordOfflinePayment).not.toHaveBeenCalled();
      expect(writeAuditLog).not.toHaveBeenCalled();
    },
  );

  it("refuses an unauthenticated request", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(null);
    const result = await recordOfflinePaymentAction({}, validForm());
    expect(result.formError).toBe("You are not authorized to record payments.");
    expect(recordOfflinePayment).not.toHaveBeenCalled();
  });
});

describe("recordOfflinePaymentAction — input", () => {
  it("rejects invalid input without calling the database", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    const result = await recordOfflinePaymentAction({}, validForm({ amount: "0" }));
    expect(result).toEqual({ formError: "Amount must be greater than zero." });
    expect(recordOfflinePayment).not.toHaveBeenCalled();
  });

  it("surfaces a database business-rule rejection without auditing or redirecting", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    vi.mocked(recordOfflinePayment).mockResolvedValue({
      ok: false,
      error: "Amount exceeds the outstanding balance of 800.00.",
    });
    const result = await recordOfflinePaymentAction({}, validForm({ amount: "900" }));
    expect(result).toEqual({
      formError: "Amount exceeds the outstanding balance of 800.00.",
    });
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("recordOfflinePaymentAction — success", () => {
  it.each([["admin"], ["super_admin"]] as const)(
    "%s records, audits minimal metadata once, and lands on the payment",
    async (role) => {
      vi.mocked(getCurrentUserContext).mockResolvedValue(context(role));
      vi.mocked(recordOfflinePayment).mockResolvedValue({
        ok: true,
        data: { id: PAYMENT_ID, paymentCode: "PAY-000043", alreadyRecorded: false },
      });

      await expect(recordOfflinePaymentAction({}, validForm())).rejects.toThrow(
        `NEXT_REDIRECT:/admin/payments/${PAYMENT_ID}?recorded=1`,
      );

      expect(recordOfflinePayment).toHaveBeenCalledWith({
        paymentId: PAYMENT_ID,
        enrollmentId: ENROLLMENT_ID,
        amount: "2500.50",
        method: "cash",
        paymentType: "partial",
        paidOn: "2026-10-09",
        reference: "Receipt book 4 / 17",
        notes: "Paid at the front desk",
      });
      expect(writeAuditLog).toHaveBeenCalledTimes(1);
      expect(writeAuditLog).toHaveBeenCalledWith({
        actorAuthUserId: `${role}-auth-1`,
        actorRole: role,
        action: "payment.recorded_offline",
        entityType: "payment",
        entityId: PAYMENT_ID,
        after: {
          paymentCode: "PAY-000043",
          enrollmentId: ENROLLMENT_ID,
          amount: "2500.50",
          method: "cash",
          paymentType: "partial",
          paidOn: "2026-10-09",
        },
      });
      expect(revalidatePath).toHaveBeenCalledWith("/admin/payments");
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/enrollments/${ENROLLMENT_ID}`);
    },
  );

  it("does not audit an idempotent resubmission twice", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    vi.mocked(recordOfflinePayment).mockResolvedValue({
      ok: true,
      data: { id: PAYMENT_ID, paymentCode: "PAY-000043", alreadyRecorded: true },
    });
    await expect(recordOfflinePaymentAction({}, validForm())).rejects.toThrow(
      `NEXT_REDIRECT:/admin/payments/${PAYMENT_ID}?recorded=1`,
    );
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
