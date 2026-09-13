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
  it.each(["agreedFee", "regularFee", "discountAmount", "registrationFee", "taxAmount"])(
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

  // Documented finding (Phase 9 report): discount_reason is not required
  // anywhere in the approved requirements or schema, even when
  // discount_amount > 0 — no CHECK constraint, no documented rule. This
  // schema does not invent one.
  it("accepts a discount amount with no discount reason", () => {
    const result = enrollmentCreateSchema.safeParse(
      baseInput({ discountAmount: "5000", discountReason: "" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discountAmount).toBe("5000");
      expect(result.data.discountReason).toBeNull();
    }
  });
});

describe("enrollmentStatusSchema", () => {
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
      expect(enrollmentStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("rejects an invented status", () => {
    expect(enrollmentStatusSchema.safeParse({ status: "hold" }).success).toBe(false);
  });
});
