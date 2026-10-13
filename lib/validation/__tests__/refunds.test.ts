import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseInitiateRazorpayRefundFormData,
  parseRecordOfflineRefundFormData,
} from "@/lib/validation/refunds";

const REFUND_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const valid = {
  refundId: REFUND_ID,
  paymentId: PAYMENT_ID,
  amount: "2000.50",
  reason: "Course downgrade",
  refundedOn: "2026-10-12",
  reference: "UTR123",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("offline refund form", () => {
  it("accepts a valid refund and normalizes an empty reference to null", () => {
    expect(parseRecordOfflineRefundFormData(form(valid))).toMatchObject({
      success: true,
      data: { amount: "2000.50", reason: "Course downgrade", reference: "UTR123" },
    });
    const noRef = parseRecordOfflineRefundFormData(form({ ...valid, reference: "  " }));
    expect(noRef.success && noRef.data.reference).toBeNull();
  });

  it.each([
    [{ amount: "0" }, "Refund amount must be greater than zero."],
    [{ amount: "-1" }, "Enter an amount in rupees with at most 2 decimal places."],
    [{ amount: "1.234" }, "Enter an amount in rupees with at most 2 decimal places."],
    [{ reason: "   " }, "Enter the reason for the refund."],
    [{ reason: "x".repeat(501) }, "Reason must be at most 500 characters."],
    [{ refundedOn: "2026-10-13" }, "Enter the refund date (today or earlier)."],
    [{ refundedOn: "not-a-date" }, "Enter the refund date (today or earlier)."],
    [{ reference: "x".repeat(101) }, "Reference must be at most 100 characters."],
    [{ refundId: "nope" }, "This form is out of date. Reload the page and try again."],
  ])("rejects %j", (override, message) => {
    const result = parseRecordOfflineRefundFormData(form({ ...valid, ...override }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe(message);
  });
});

describe("Razorpay refund form", () => {
  it("carries only the refund id, payment id, amount and reason — never a provider id", () => {
    const fd = form({ ...valid, razorpay_payment_id: "pay_FORGED" });
    const result = parseInitiateRazorpayRefundFormData(fd);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data).sort()).toEqual(
        ["amount", "paymentId", "reason", "refundId"].sort(),
      );
    }
  });
});
