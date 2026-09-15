import { describe, expect, it } from "vitest";
import {
  computeTotalPayable,
  enrollmentStatusRequiresBatch,
  isEnrollmentStatus,
  isPaymentPlanType,
  isTerminalReactivationBlocked,
} from "@/lib/domain/enrollments";

describe("isEnrollmentStatus", () => {
  it("accepts every value the schema's CHECK constraint allows", () => {
    for (const status of [
      "lead",
      "applicant",
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

  // Manual-acceptance correction (Sept 2026): "Registered" was removed as a
  // separate stage — Registered and Enrolled are not distinct for this
  // workflow. It must be rejected exactly like any other invented status.
  it("rejects the removed 'registered' status", () => {
    expect(isEnrollmentStatus("registered")).toBe(false);
  });

  it("rejects anything else", () => {
    expect(isEnrollmentStatus("hold")).toBe(false);
    expect(isEnrollmentStatus("")).toBe(false);
    expect(isEnrollmentStatus(null)).toBe(false);
    expect(isEnrollmentStatus(42)).toBe(false);
  });
});

describe("enrollmentStatusRequiresBatch — approved rule: an Enrollment may not be operational without a Batch", () => {
  it.each(["lead", "applicant"])(
    "does not require a Batch for the pre-enrollment status %s",
    (status) => {
      expect(enrollmentStatusRequiresBatch(status as never)).toBe(false);
    },
  );

  it.each(["enrolled", "active", "on_hold", "completed"])(
    "requires a Batch for the operational status %s",
    (status) => {
      expect(enrollmentStatusRequiresBatch(status as never)).toBe(true);
    },
  );

  // Withdrawn/Cancelled are historical/terminal — deliberately excluded
  // from this rule so their existing batch_id (whatever it is) is never
  // second-guessed by it.
  it.each(["withdrawn", "cancelled"])(
    "does not apply to the terminal status %s",
    (status) => {
      expect(enrollmentStatusRequiresBatch(status as never)).toBe(false);
    },
  );
});

describe("isTerminalReactivationBlocked — approved rule: Cancelled/Withdrawn cannot reactivate through the normal status control", () => {
  it.each(["withdrawn", "cancelled"])(
    "blocks %s -> enrolled/active/on_hold/completed",
    (terminal) => {
      for (const operational of ["enrolled", "active", "on_hold", "completed"]) {
        expect(
          isTerminalReactivationBlocked(terminal as never, operational as never),
        ).toBe(true);
      }
    },
  );

  // Only the move INTO an operational status is blocked — this does not
  // invent a full transition state machine. Terminal-to-terminal and
  // terminal-to-pre-enrollment transitions are untouched by this rule.
  it.each(["lead", "applicant", "withdrawn", "cancelled"])(
    "does not block cancelled -> %s",
    (next) => {
      expect(isTerminalReactivationBlocked("cancelled", next as never)).toBe(false);
    },
  );

  it.each(["enrolled", "active", "on_hold", "completed"])(
    "does not block a non-terminal current status moving to %s",
    (operational) => {
      for (const current of [
        "lead",
        "applicant",
        "enrolled",
        "active",
        "on_hold",
        "completed",
      ]) {
        expect(
          isTerminalReactivationBlocked(current as never, operational as never),
        ).toBe(false);
      }
    },
  );
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
