import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const refund = vi.fn();
const fetchMultipleRefund = vi.fn();
vi.mock("razorpay", () => ({
  default: vi.fn(function Razorpay() {
    return { payments: { refund, fetchMultipleRefund } };
  }),
}));

import {
  createRazorpayGateway,
  isDefinitiveRejection,
} from "@/lib/payments/razorpay-gateway";

// Test-only placeholder credentials.
const gateway = () =>
  createRazorpayGateway({ keyId: "rzp_test_UNITTEST01", keySecret: "unit-test-secret" });

beforeEach(() => vi.clearAllMocks());

describe("Razorpay gateway — refunds", () => {
  it("creates a normal-speed refund for integer paise with our receipt and notes", async () => {
    refund.mockResolvedValue({
      id: "rfnd_1",
      payment_id: "pay_1",
      amount: 200000,
      currency: "INR",
      status: "pending",
      notes: { roicians_refund_id: "r-1", other: 5 },
    });
    const result = await gateway().createRefund({
      paymentId: "pay_1",
      amountPaise: 200000,
      receipt: "r-1",
      notes: { roicians_refund_id: "r-1" },
    });
    expect(refund).toHaveBeenCalledWith("pay_1", {
      amount: 200000,
      speed: "normal",
      receipt: "r-1",
      notes: { roicians_refund_id: "r-1" },
    });
    expect(result).toEqual({
      id: "rfnd_1",
      paymentId: "pay_1",
      amountPaise: 200000,
      currency: "INR",
      status: "pending",
      notes: { roicians_refund_id: "r-1", other: "5" },
    });
  });

  it("refuses a non-integer or non-positive amount before calling Razorpay", async () => {
    for (const amountPaise of [0, -1, 1.5]) {
      await expect(
        gateway().createRefund({
          paymentId: "pay_1",
          amountPaise,
          receipt: "r",
          notes: {},
        }),
      ).rejects.toThrow("positive integer");
    }
    expect(refund).not.toHaveBeenCalled();
  });

  it("lists a payment's refunds", async () => {
    fetchMultipleRefund.mockResolvedValue({
      entity: "collection",
      count: 1,
      items: [
        {
          id: "rfnd_2",
          payment_id: "pay_1",
          amount: 100,
          currency: "INR",
          status: "processed",
        },
      ],
    });
    expect(await gateway().listRefunds("pay_1")).toEqual([
      {
        id: "rfnd_2",
        paymentId: "pay_1",
        amountPaise: 100,
        currency: "INR",
        status: "processed",
        notes: {},
      },
    ]);
    expect(fetchMultipleRefund).toHaveBeenCalledWith("pay_1", { count: 100 });
  });

  it("treats only a definite 4xx answer as 'nothing was created'", () => {
    expect(isDefinitiveRejection({ statusCode: 400 })).toBe(true);
    expect(isDefinitiveRejection({ statusCode: 404 })).toBe(true);
    for (const error of [
      { statusCode: 408 },
      { statusCode: 429 },
      { statusCode: 500 },
      new Error("ETIMEDOUT"),
      null,
    ]) {
      expect(isDefinitiveRejection(error)).toBe(false);
    }
  });
});
