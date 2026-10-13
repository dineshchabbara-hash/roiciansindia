import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentUserContext: vi.fn() }));
vi.mock("@/lib/data/refunds", () => ({
  recordOfflineRefund: vi.fn(),
  initiateRazorpayRefund: vi.fn(),
  syncRazorpayRefund: vi.fn(),
}));
vi.mock("@/lib/data/audit-log", () => ({ writeAuditLog: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  initiateRazorpayRefundAction,
  recordOfflineRefundAction,
  syncRazorpayRefundAction,
} from "@/lib/actions/refunds";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  initiateRazorpayRefund,
  recordOfflineRefund,
  syncRazorpayRefund,
} from "@/lib/data/refunds";
import { writeAuditLog } from "@/lib/data/audit-log";
import { revalidatePath } from "next/cache";

const REFUND_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";

function context(role: "admin" | "super_admin" | "trainer" | "student") {
  return {
    authUserId: `${role}-auth-1`,
    email: `${role}@example.com`,
    role,
    profileId: `${role}-profile-1`,
    displayName: `Test ${role}`,
  };
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const offline = {
  refundId: REFUND_ID,
  paymentId: PAYMENT_ID,
  amount: "2000.00",
  reason: "Downgrade",
  refundedOn: "2026-10-12",
  reference: "",
};
const online = {
  refundId: REFUND_ID,
  paymentId: PAYMENT_ID,
  amount: "2000.00",
  reason: "Batch cancelled",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
});

describe("authorization", () => {
  it.each([["trainer"], ["student"]] as const)(
    "refuses a %s for every refund action",
    async (role) => {
      vi.mocked(getCurrentUserContext).mockResolvedValue(context(role));
      expect(await recordOfflineRefundAction({}, form(offline))).toEqual({
        formError: "You are not authorized to refund payments.",
      });
      expect(await initiateRazorpayRefundAction({}, form(online))).toEqual({
        formError: "You are not authorized to refund payments.",
      });
      expect(
        await syncRazorpayRefundAction(
          {},
          form({ refundId: REFUND_ID, paymentId: PAYMENT_ID }),
        ),
      ).toEqual({ formError: "You are not authorized to refund payments." });
      expect(recordOfflineRefund).not.toHaveBeenCalled();
      expect(initiateRazorpayRefund).not.toHaveBeenCalled();
      expect(syncRazorpayRefund).not.toHaveBeenCalled();
    },
  );

  it("refuses an unauthenticated request", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(null);
    expect((await recordOfflineRefundAction({}, form(offline))).formError).toBe(
      "You are not authorized to refund payments.",
    );
  });
});

describe("recordOfflineRefundAction", () => {
  it.each([["admin"], ["super_admin"]] as const)(
    "%s records the refund and audits it once",
    async (role) => {
      vi.mocked(getCurrentUserContext).mockResolvedValue(context(role));
      vi.mocked(recordOfflineRefund).mockResolvedValue({
        ok: true,
        data: { id: REFUND_ID, alreadyRecorded: false },
      });
      expect(await recordOfflineRefundAction({}, form(offline))).toEqual({
        message: "Refund of ₹2000.00 recorded.",
      });
      expect(recordOfflineRefund).toHaveBeenCalledWith({ ...offline, reference: null });
      expect(writeAuditLog).toHaveBeenCalledExactlyOnceWith({
        actorAuthUserId: `${role}-auth-1`,
        actorRole: role,
        action: "refund.recorded_offline",
        entityType: "refund",
        entityId: REFUND_ID,
        after: {
          paymentId: PAYMENT_ID,
          amount: "2000.00",
          refundedOn: "2026-10-12",
          status: "processed",
        },
      });
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/payments/${PAYMENT_ID}`);
    },
  );

  it("does not audit a resubmitted form twice", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    vi.mocked(recordOfflineRefund).mockResolvedValue({
      ok: true,
      data: { id: REFUND_ID, alreadyRecorded: true },
    });
    await recordOfflineRefundAction({}, form(offline));
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects invalid input before the database and passes rule refusals through", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    expect(
      await recordOfflineRefundAction({}, form({ ...offline, amount: "0" })),
    ).toEqual({
      formError: "Refund amount must be greater than zero.",
    });
    expect(recordOfflineRefund).not.toHaveBeenCalled();
    vi.mocked(recordOfflineRefund).mockResolvedValue({
      ok: false,
      error: "Amount exceeds the refundable balance of 800.00.",
    });
    expect(await recordOfflineRefundAction({}, form(offline))).toEqual({
      formError: "Amount exceeds the refundable balance of 800.00.",
    });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("initiateRazorpayRefundAction", () => {
  it("audits the initiation once and explains the balance changes only when processed", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    vi.mocked(initiateRazorpayRefund).mockResolvedValue({
      ok: true,
      data: {
        id: REFUND_ID,
        status: "initiated",
        alreadyReserved: false,
        awaitingConfirmation: true,
      },
    });
    const state = await initiateRazorpayRefundAction({}, form(online));
    expect(state.message).toContain("awaiting Razorpay's confirmation");
    expect(state.message).toContain("The balance changes only once it is processed.");
    expect(writeAuditLog).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: "refund.initiated", entityId: REFUND_ID }),
    );
  });

  it("reports processed, failed and repeated submissions", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    vi.mocked(initiateRazorpayRefund).mockResolvedValueOnce({
      ok: true,
      data: {
        id: REFUND_ID,
        status: "processed",
        alreadyReserved: false,
        awaitingConfirmation: false,
      },
    });
    expect((await initiateRazorpayRefundAction({}, form(online))).message).toBe(
      "Refund of ₹2000.00 processed by Razorpay.",
    );
    vi.mocked(initiateRazorpayRefund).mockResolvedValueOnce({
      ok: true,
      data: {
        id: REFUND_ID,
        status: "failed",
        alreadyReserved: false,
        awaitingConfirmation: false,
      },
    });
    expect((await initiateRazorpayRefundAction({}, form(online))).formError).toBe(
      "Razorpay could not process this refund. No money was refunded.",
    );
    vi.mocked(writeAuditLog).mockClear();
    vi.mocked(initiateRazorpayRefund).mockResolvedValueOnce({
      ok: true,
      data: {
        id: REFUND_ID,
        status: "initiated",
        alreadyReserved: true,
        awaitingConfirmation: true,
      },
    });
    await initiateRazorpayRefundAction({}, form(online));
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("syncRazorpayRefundAction", () => {
  it("validates ids and reports the reconciled state", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    expect(
      await syncRazorpayRefundAction({}, form({ refundId: "x", paymentId: PAYMENT_ID })),
    ).toEqual({
      formError: "Invalid refund.",
    });
    vi.mocked(syncRazorpayRefund).mockResolvedValue({
      ok: true,
      data: { status: "processed" },
    });
    expect(
      await syncRazorpayRefundAction(
        {},
        form({ refundId: REFUND_ID, paymentId: PAYMENT_ID }),
      ),
    ).toEqual({ message: "Razorpay confirmed the refund." });
  });
});
