import { describe, expect, it } from "vitest";
import {
  canAssignBatch,
  computeTotalPayable,
  enrollmentStatusRequiresBatch,
  isEnrollmentStatus,
  isPaymentPlanType,
  isTerminalStatusChangeBlocked,
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

describe("isTerminalStatusChangeBlocked — approved rule: Cancelled/Withdrawn/Completed cannot be reopened through the normal status control", () => {
  // Closes the "cancelled -> lead -> enrolled" bypass: a terminal status
  // blocks a move to ANY different status, not only operational ones.
  it.each(["withdrawn", "cancelled", "completed"])(
    "(16-32) blocks %s -> every other ordinary status",
    (terminal) => {
      for (const next of [
        "lead",
        "applicant",
        "enrolled",
        "active",
        "on_hold",
        "completed",
        "withdrawn",
        "cancelled",
      ]) {
        if (next === terminal) continue;
        expect(isTerminalStatusChangeBlocked(terminal as never, next as never)).toBe(
          true,
        );
      }
    },
  );

  it.each(["withdrawn", "cancelled", "completed"])(
    "does not block %s -> itself (a no-op re-submission)",
    (terminal) => {
      expect(isTerminalStatusChangeBlocked(terminal as never, terminal as never)).toBe(
        false,
      );
    },
  );

  // (34) The bypass this rule specifically closes: a terminal status is
  // never allowed to reach lead/applicant either, so it can never be routed
  // back to an operational status through that detour.
  it.each(["withdrawn", "cancelled", "completed"])(
    "(34) blocks the terminal-status-via-lead/applicant bypass for %s",
    (terminal) => {
      expect(isTerminalStatusChangeBlocked(terminal as never, "lead")).toBe(true);
      expect(isTerminalStatusChangeBlocked(terminal as never, "applicant")).toBe(true);
    },
  );

  it.each(["enrolled", "active", "on_hold", "completed", "lead", "applicant"])(
    "does not block a non-terminal current status moving to %s",
    (next) => {
      for (const current of ["lead", "applicant", "enrolled", "active", "on_hold"]) {
        expect(isTerminalStatusChangeBlocked(current as never, next as never)).toBe(
          false,
        );
      }
    },
  );
});

describe("canAssignBatch — approved rule: a Batch may only be assigned/changed while pre-enrollment", () => {
  it.each(["lead", "applicant"])("allows Batch assignment for %s", (status) => {
    expect(canAssignBatch(status as never)).toBe(true);
  });

  it.each(["enrolled", "active", "on_hold", "completed", "withdrawn", "cancelled"])(
    "does not allow Batch assignment for %s",
    (status) => {
      expect(canAssignBatch(status as never)).toBe(false);
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
