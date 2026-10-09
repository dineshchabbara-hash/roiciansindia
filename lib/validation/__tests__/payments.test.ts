import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRecordOfflinePaymentFormData } from "@/lib/validation/payments";

const PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENROLLMENT_ID = "11111111-2222-4333-8444-555555555555";

function form(overrides: Record<string, string | null> = {}): FormData {
  const values: Record<string, string | null> = {
    paymentId: PAYMENT_ID,
    enrollmentId: ENROLLMENT_ID,
    amount: "2500.50",
    method: "upi",
    paymentType: "partial",
    paidOn: "2026-10-09",
    reference: "  UTR-77  ",
    notes: "",
    ...overrides,
  };
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) fd.set(key, value);
  }
  return fd;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordOfflinePaymentSchema", () => {
  it("accepts a valid offline payment and normalizes optional text", () => {
    const result = parseRecordOfflinePaymentFormData(form());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      paymentId: PAYMENT_ID,
      enrollmentId: ENROLLMENT_ID,
      amount: "2500.50",
      method: "upi",
      paymentType: "partial",
      paidOn: "2026-10-09",
      reference: "UTR-77",
      notes: null,
    });
  });

  it("keeps the amount as the exact decimal string (no float conversion)", () => {
    const result = parseRecordOfflinePaymentFormData(form({ amount: "0.29" }));
    expect(result.success && result.data.amount).toBe("0.29");
  });

  it.each([
    ["zero amount", { amount: "0" }, "Amount must be greater than zero."],
    ["zero with decimals", { amount: "0.00" }, "Amount must be greater than zero."],
    [
      "negative",
      { amount: "-5" },
      "Enter an amount in rupees with at most 2 decimal places.",
    ],
    [
      "sub-paisa",
      { amount: "1.005" },
      "Enter an amount in rupees with at most 2 decimal places.",
    ],
    [
      "grouped",
      { amount: "1,000" },
      "Enter an amount in rupees with at most 2 decimal places.",
    ],
    [
      "missing",
      { amount: null },
      "Enter an amount in rupees with at most 2 decimal places.",
    ],
    ["online method", { method: "razorpay" }, "Choose a payment method."],
    ["other method", { method: "other" }, "Choose a payment method."],
    ["installment type", { paymentType: "installment" }, "Choose a payment type."],
    ["refund type", { paymentType: "refund" }, "Choose a payment type."],
    [
      "future date",
      { paidOn: "2026-10-10" },
      "Enter the date received (today or earlier).",
    ],
    [
      "impossible date",
      { paidOn: "2026-02-30" },
      "Enter the date received (today or earlier).",
    ],
    [
      "long reference",
      { reference: "x".repeat(101) },
      "Reference must be at most 100 characters.",
    ],
    ["long notes", { notes: "x".repeat(1001) }, "Notes must be at most 1000 characters."],
    [
      "tampered enrollment id",
      { enrollmentId: "ENR-000001" },
      "This form is out of date. Reload the page and try again.",
    ],
    [
      "missing payment id",
      { paymentId: null },
      "This form is out of date. Reload the page and try again.",
    ],
  ])("rejects %s", (_label, overrides, message) => {
    const result = parseRecordOfflinePaymentFormData(form(overrides));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe(message);
  });

  it("never reads a submitted student, admin, status, tax or code", () => {
    const fd = form();
    fd.set("studentId", "attacker");
    fd.set("createdBy", "attacker");
    fd.set("status", "refunded");
    fd.set("taxAmount", "999");
    fd.set("paymentCode", "PAY-999999");
    const result = parseRecordOfflinePaymentFormData(fd);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data).sort()).toEqual(
      [
        "amount",
        "enrollmentId",
        "method",
        "notes",
        "paidOn",
        "paymentId",
        "paymentType",
        "reference",
      ].sort(),
    );
  });
});
