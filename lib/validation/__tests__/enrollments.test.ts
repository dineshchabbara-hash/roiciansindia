import { describe, expect, it } from "vitest";
import {
  enrollmentCreateSchema,
  enrollmentStatusSchema,
} from "@/lib/validation/enrollments";

const VALID_STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_PROGRAM_ID = "22222222-2222-4222-8222-222222222222";
const VALID_BATCH_ID = "33333333-3333-4333-8333-333333333333";

function baseInput(overrides: Record<string, string> = {}) {
  return {
    studentId: VALID_STUDENT_ID,
    programId: VALID_PROGRAM_ID,
    batchId: "",
    enrollmentDate: "",
    regularFee: "50000",
    agreedFee: "45000",
    discountAmount: "",
    discountReason: "",
    registrationFee: "",
    taxAmount: "",
    paymentPlanType: "",
    source: "",
    notes: "",
    ...overrides,
  };
}

describe("enrollmentCreateSchema", () => {
  it("accepts a minimal valid submission and fills in the documented defaults", () => {
    const result = enrollmentCreateSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        studentId: VALID_STUDENT_ID,
        programId: VALID_PROGRAM_ID,
        batchId: null,
        enrollmentDate: null,
        regularFee: "50000",
        agreedFee: "45000",
        discountAmount: "0",
        discountReason: null,
        registrationFee: "0",
        taxAmount: "0",
        paymentPlanType: null,
        source: null,
        notes: null,
      });
    }
  });

  it("accepts a full submission including an optional Batch", () => {
    const result = enrollmentCreateSchema.safeParse(
      baseInput({
        batchId: VALID_BATCH_ID,
        enrollmentDate: "2026-09-01",
        discountAmount: "5000",
        discountReason: "Early bird",
        registrationFee: "1000",
        taxAmount: "2000",
        paymentPlanType: "installments",
        source: "referral",
        notes: "VIP",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.batchId).toBe(VALID_BATCH_ID);
      expect(result.data.enrollmentDate).toBe("2026-09-01");
      expect(result.data.discountAmount).toBe("5000");
      expect(result.data.discountReason).toBe("Early bird");
      expect(result.data.paymentPlanType).toBe("installments");
    }
  });

  // No tax is currently charged on enrollments (manual-acceptance
  // correction, Sept 2026) — tax_amount is always forced to "0" server-side,
  // regardless of what the client submits. A tampered/non-zero browser
  // value must never reach the created record.
  it('forces taxAmount to "0" even when the client submits a non-zero value', () => {
    const result = enrollmentCreateSchema.safeParse(baseInput({ taxAmount: "2000" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.taxAmount).toBe("0");
    }
  });

  it('forces taxAmount to "0" even when the client submits an invalid/negative value', () => {
    const result = enrollmentCreateSchema.safeParse(baseInput({ taxAmount: "-500" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.taxAmount).toBe("0");
    }
  });

  it("rejects a missing/invalid student id", () => {
    const result = enrollmentCreateSchema.safeParse(
      baseInput({ studentId: "not-a-uuid" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a missing/invalid program id", () => {
    const result = enrollmentCreateSchema.safeParse(baseInput({ programId: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects an invalid batch id when provided", () => {
    const result = enrollmentCreateSchema.safeParse(baseInput({ batchId: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });

  it("rejects a malformed enrollment date", () => {
    const result = enrollmentCreateSchema.safeParse(
      baseInput({ enrollmentDate: "09/01/2026" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a missing regular fee", () => {
    const result = enrollmentCreateSchema.safeParse(baseInput({ regularFee: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects a missing agreed fee", () => {
    const result = enrollmentCreateSchema.safeParse(baseInput({ agreedFee: "" }));
    expect(result.success).toBe(false);
  });

  // A leading minus sign never matches MONEY_PATTERN, so a negative amount
  // is structurally impossible to submit through this schema — this is the
  // "reject invalid negative monetary values" requirement enforced at the
  // input-shape level, distinct from the total-payable-can't-go-negative
  // check enforced in lib/data/enrollments.ts (tested separately, since
  // that one depends on the interaction between fields, not one field's
  // own shape).
  // taxAmount is deliberately excluded here: it is always forced to "0"
  // server-side regardless of the client's input, so a negative/malformed
  // submission for that one field no longer causes a rejection — see the
  // "forces taxAmount" tests above instead.
  it.each(["agreedFee", "regularFee", "discountAmount", "registrationFee"])(
    "rejects a negative %s",
    (field) => {
      const result = enrollmentCreateSchema.safeParse(baseInput({ [field]: "-100" }));
      expect(result.success).toBe(false);
    },
  );

  it("rejects an invalid payment plan type", () => {
    const result = enrollmentCreateSchema.safeParse(
      baseInput({ paymentPlanType: "emi" }),
    );
    expect(result.success).toBe(false);
  });

  // Manual-acceptance correction (Sept 2026): discount_reason is required
  // whenever a discount is actually applied (discountAmount > 0), and
  // optional/blank otherwise. Reversal of the earlier Phase 9 finding.
  it("accepts a zero discount amount with a blank discount reason", () => {
    const result = enrollmentCreateSchema.safeParse(
      baseInput({ discountAmount: "", discountReason: "" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discountAmount).toBe("0");
      expect(result.data.discountReason).toBeNull();
    }
  });

  it("rejects a positive discount amount with a blank discount reason", () => {
    const result = enrollmentCreateSchema.safeParse(
      baseInput({ discountAmount: "5000", discountReason: "" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.discountReason).toContain(
        "Please enter a reason for the discount.",
      );
    }
  });

  it("rejects a positive discount amount with a whitespace-only discount reason", () => {
    const result = enrollmentCreateSchema.safeParse(
      baseInput({ discountAmount: "5000", discountReason: "   " }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.discountReason).toContain(
        "Please enter a reason for the discount.",
      );
    }
  });

  it("accepts a positive discount amount with a valid discount reason", () => {
    const result = enrollmentCreateSchema.safeParse(
      baseInput({ discountAmount: "5000", discountReason: "Early Bird" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discountAmount).toBe("5000");
      expect(result.data.discountReason).toBe("Early Bird");
    }
  });

  it("trims the discount reason before persistence", () => {
    const result = enrollmentCreateSchema.safeParse(
      baseInput({ discountAmount: "5000", discountReason: "  Early Bird  " }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discountReason).toBe("Early Bird");
    }
  });
});

describe("enrollmentStatusSchema", () => {
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
      expect(enrollmentStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("rejects an invented status", () => {
    expect(enrollmentStatusSchema.safeParse({ status: "hold" }).success).toBe(false);
  });

  // Manual-acceptance correction (Sept 2026): "Registered" was removed as a
  // separate stage — no longer accepted by server-side validation.
  it("rejects the removed 'registered' status", () => {
    expect(enrollmentStatusSchema.safeParse({ status: "registered" }).success).toBe(
      false,
    );
  });
});
