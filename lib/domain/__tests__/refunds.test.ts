import { describe, expect, it } from "vitest";
import {
  canRefund,
  outstandingAfterRefund,
  paymentDisplayStatus,
  paymentRefundState,
  refundChannelFor,
  refundStatusLabel,
  summarizePaymentRefunds,
} from "@/lib/domain/refunds";

describe("summarizePaymentRefunds", () => {
  it("counts processed as refunded, initiated as reserved, and ignores failed", () => {
    expect(
      summarizePaymentRefunds(1_000_000, [
        { amountPaise: 200_000, status: "processed" },
        { amountPaise: 300_000, status: "initiated" },
        { amountPaise: 400_000, status: "failed" },
      ]),
    ).toEqual({
      paymentPaise: 1_000_000,
      refundedPaise: 200_000,
      inProgressPaise: 300_000,
      refundablePaise: 500_000,
    });
  });

  it("never reports negative refundable capacity", () => {
    expect(
      summarizePaymentRefunds(100, [{ amountPaise: 100, status: "processed" }])
        .refundablePaise,
    ).toBe(0);
  });
});

describe("derived payment refund state (display only)", () => {
  it("labels partially and fully refunded paid payments without changing the status", () => {
    const partial = summarizePaymentRefunds(1_000_000, [
      { amountPaise: 200_000, status: "processed" },
    ]);
    const full = summarizePaymentRefunds(1_000_000, [
      { amountPaise: 600_000, status: "processed" },
      { amountPaise: 400_000, status: "processed" },
    ]);
    const pendingOnly = summarizePaymentRefunds(1_000_000, [
      { amountPaise: 200_000, status: "initiated" },
    ]);
    expect(paymentRefundState(partial)).toBe("partially_refunded");
    expect(paymentRefundState(full)).toBe("fully_refunded");
    expect(paymentRefundState(pendingOnly)).toBe("none");
    expect(paymentDisplayStatus("paid", "Paid", partial)).toBe(
      "Paid — Partially Refunded",
    );
    expect(paymentDisplayStatus("paid", "Paid", full)).toBe("Paid — Fully Refunded");
    expect(paymentDisplayStatus("paid", "Paid", pendingOnly)).toBe("Paid");
    expect(paymentDisplayStatus("authorized", "Held for review", partial)).toBe(
      "Held for review",
    );
  });

  it("only a paid payment with capacity left can be refunded", () => {
    const some = summarizePaymentRefunds(500_000, []);
    const none = summarizePaymentRefunds(500_000, [
      { amountPaise: 500_000, status: "initiated" },
    ]);
    expect(canRefund("paid", some)).toBe(true);
    expect(canRefund("paid", none)).toBe(false);
    for (const status of ["pending", "authorized", "failed", "cancelled"]) {
      expect(canRefund(status, some)).toBe(false);
    }
  });
});

describe("refund rules", () => {
  it("routes Razorpay payments to Razorpay and everything else to an offline refund", () => {
    expect(refundChannelFor("razorpay")).toBe("razorpay");
    for (const method of ["cash", "upi", "bank_transfer", "cheque", "other"]) {
      expect(refundChannelFor(method)).toBe("offline");
    }
  });

  it("D8 option A: a processed refund raises outstanding by exactly its amount", () => {
    // payable 10,000 − paid 10,000 → 0; refund 2,000 → 2,000.
    expect(outstandingAfterRefund(0, 200_000)).toBe(200_000);
    expect(outstandingAfterRefund(150_000, 50)).toBe(150_050);
    expect(outstandingAfterRefund(150_000, -5)).toBe(150_000);
  });

  it("labels refund statuses", () => {
    expect(refundStatusLabel("initiated")).toBe("In progress");
    expect(refundStatusLabel("processed")).toBe("Refunded");
    expect(refundStatusLabel("failed")).toBe("Failed");
  });
});
