import { describe, expect, it } from "vitest";
import {
  computeTotalPayable,
  isEnrollmentStatus,
  isPaymentPlanType,
} from "@/lib/domain/enrollments";

describe("isEnrollmentStatus", () => {
  it("accepts every value the schema's CHECK constraint allows", () => {
    for (const status of [
      "lead",
      "applicant",
      "registered",
      "enrolled",
      "active",
      "on_hold",
      "completed",
      "withdrawn",
      "cancelled",
    ]) {
      expect(isEnrollmentStatus(status)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isEnrollmentStatus("hold")).toBe(false);
    expect(isEnrollmentStatus("")).toBe(false);
    expect(isEnrollmentStatus(null)).toBe(false);
    expect(isEnrollmentStatus(42)).toBe(false);
  });
});

describe("isPaymentPlanType", () => {
  it("accepts full and installments only", () => {
    expect(isPaymentPlanType("full")).toBe(true);
    expect(isPaymentPlanType("installments")).toBe(true);
    expect(isPaymentPlanType("emi")).toBe(false);
    expect(isPaymentPlanType(null)).toBe(false);
  });
});

describe("computeTotalPayable — approved formula: agreed_fee - discount_amount + registration_fee + tax_amount", () => {
  it("computes the standard case", () => {
    expect(
      computeTotalPayable({
        agreedFee: "50000",
        discountAmount: "5000",
        registrationFee: "1000",
        taxAmount: "2000",
      }),
    ).toBe(48000);
  });

  it("is decimal-safe for cents — never reintroduces JS float drift", () => {
    // A classic float trap: 0.1 + 0.2 !== 0.3 in raw JS arithmetic.
    expect(
      computeTotalPayable({
        agreedFee: "100.10",
        discountAmount: "0",
        registrationFee: "0.20",
        taxAmount: "0",
      }),
    ).toBeCloseTo(100.3, 2);
  });

  it("can go negative when discount exceeds the other terms — the caller is responsible for rejecting that", () => {
    // This function is a pure calculator; the "reject negative payable"
    // business rule lives in lib/data/enrollments.ts's createEnrollmentRecord,
    // tested separately.
    expect(
      computeTotalPayable({
        agreedFee: "1000",
        discountAmount: "5000",
        registrationFee: "0",
        taxAmount: "0",
      }),
    ).toBe(-4000);
  });

  it("defaults of 0 for discount/registration/tax reproduce agreed_fee exactly", () => {
    expect(
      computeTotalPayable({
        agreedFee: "25000",
        discountAmount: "0",
        registrationFee: "0",
        taxAmount: "0",
      }),
    ).toBe(25000);
  });

  // Manual-acceptance scenario (no tax is currently charged on
  // enrollments): 50000.50 - 5000.00 + 500.50 + 0.00 = 45501.00.
  it("computes the manual-acceptance scenario exactly with tax_amount = 0", () => {
    expect(
      computeTotalPayable({
        agreedFee: "50000.50",
        discountAmount: "5000.00",
        registrationFee: "500.50",
        taxAmount: "0",
      }),
    ).toBe(45501.0);
  });
});
