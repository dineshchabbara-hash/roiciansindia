import { describe, expect, it } from "vitest";
import { programProfileSchema, programStatusSchema } from "@/lib/validation/programs";

function baseInput() {
  return {
    programCode: "FSD-101",
    name: "Full Stack Development",
    description: "",
    category: "",
    durationValue: "",
    durationUnit: "",
    deliveryMode: "",
    regularFee: "50000",
    registrationFee: "",
    taxRatePercent: "",
    certificateEligible: undefined,
    installmentsAllowed: undefined,
  };
}

describe("programProfileSchema", () => {
  it("accepts a minimal valid submission, defaulting optional money/boolean fields", () => {
    const result = programProfileSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      programCode: "FSD-101",
      name: "Full Stack Development",
      description: null,
      category: null,
      durationValue: null,
      durationUnit: null,
      deliveryMode: null,
      regularFee: "50000",
      registrationFee: "0",
      taxRatePercent: null,
      certificateEligible: false,
      installmentsAllowed: false,
    });
  });

  it("passes decimal fee strings through unchanged rather than through a JS float", () => {
    const result = programProfileSchema.safeParse({
      ...baseInput(),
      regularFee: "49999.99",
      registrationFee: "1000.50",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Not 49999.99000000001 or similar — the exact string round-trips.
    expect(result.data.regularFee).toBe("49999.99");
    expect(result.data.registrationFee).toBe("1000.50");
  });

  // Regression coverage for the exact values from the Phase 7 money-precision
  // bug report — the schema layer itself was already exact (the reported
  // rounding traced to the display formatter instead), but this locks that
  // in for both fee fields.
  it.each(["50000.50", "500.50", "50000.99", "0.50", "50000"])(
    "preserves %s exactly for both regularFee and registrationFee",
    (amount) => {
      const result = programProfileSchema.safeParse({
        ...baseInput(),
        regularFee: amount,
        registrationFee: amount,
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.regularFee).toBe(amount);
      expect(result.data.registrationFee).toBe(amount);
    },
  );

  it("requires program code and program name", () => {
    const missingCode = programProfileSchema.safeParse({
      ...baseInput(),
      programCode: "",
    });
    expect(missingCode.success).toBe(false);
    if (!missingCode.success) {
      expect(missingCode.error.flatten().fieldErrors.programCode?.[0]).toMatch(
        /required/i,
      );
    }

    const missingName = programProfileSchema.safeParse({ ...baseInput(), name: "" });
    expect(missingName.success).toBe(false);
  });

  it("requires regular fee and rejects a negative or malformed amount", () => {
    const missing = programProfileSchema.safeParse({ ...baseInput(), regularFee: "" });
    expect(missing.success).toBe(false);

    const malformed = programProfileSchema.safeParse({
      ...baseInput(),
      regularFee: "-100",
    });
    expect(malformed.success).toBe(false);
    if (!malformed.success) {
      expect(malformed.error.flatten().fieldErrors.regularFee?.[0]).toMatch(
        /non-negative/i,
      );
    }

    const tooManyDecimals = programProfileSchema.safeParse({
      ...baseInput(),
      regularFee: "100.999",
    });
    expect(tooManyDecimals.success).toBe(false);
  });

  it("rejects a malformed registration fee even when regular fee is valid", () => {
    const result = programProfileSchema.safeParse({
      ...baseInput(),
      registrationFee: "abc",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.registrationFee?.[0]).toMatch(
        /non-negative/i,
      );
    }
  });

  it("accepts a blank tax rate (meaning: use the company default)", () => {
    const result = programProfileSchema.safeParse({ ...baseInput(), taxRatePercent: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.taxRatePercent).toBeNull();
  });

  it("rejects a tax rate above 100%, even though the column itself allows up to 999.99", () => {
    const result = programProfileSchema.safeParse({
      ...baseInput(),
      taxRatePercent: "150",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid tax rate at the boundary", () => {
    const result = programProfileSchema.safeParse({
      ...baseInput(),
      taxRatePercent: "18.5",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.taxRatePercent).toBe("18.5");
  });

  it("requires duration value to be a positive whole number when provided", () => {
    const zero = programProfileSchema.safeParse({ ...baseInput(), durationValue: "0" });
    expect(zero.success).toBe(false);

    const decimal = programProfileSchema.safeParse({
      ...baseInput(),
      durationValue: "3.5",
    });
    expect(decimal.success).toBe(false);

    const valid = programProfileSchema.safeParse({
      ...baseInput(),
      durationValue: "8",
      durationUnit: "weeks",
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.durationValue).toBe(8);
      expect(valid.data.durationUnit).toBe("weeks");
    }
  });

  it("rejects a duration unit or delivery mode outside the schema's CHECK constraint", () => {
    const badUnit = programProfileSchema.safeParse({
      ...baseInput(),
      durationValue: "4",
      durationUnit: "years",
    });
    expect(badUnit.success).toBe(false);

    const badMode = programProfileSchema.safeParse({
      ...baseInput(),
      deliveryMode: "remote",
    });
    expect(badMode.success).toBe(false);
  });

  it("accepts a valid delivery mode", () => {
    const result = programProfileSchema.safeParse({
      ...baseInput(),
      deliveryMode: "hybrid",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.deliveryMode).toBe("hybrid");
  });

  it("treats the certificate-eligible/installments-allowed checkboxes as booleans, on when checked", () => {
    const checked = programProfileSchema.safeParse({
      ...baseInput(),
      certificateEligible: "on",
      installmentsAllowed: "on",
    });
    expect(checked.success).toBe(true);
    if (checked.success) {
      expect(checked.data.certificateEligible).toBe(true);
      expect(checked.data.installmentsAllowed).toBe(true);
    }

    const unchecked = programProfileSchema.safeParse(baseInput());
    expect(unchecked.success).toBe(true);
    if (unchecked.success) {
      expect(unchecked.data.certificateEligible).toBe(false);
      expect(unchecked.data.installmentsAllowed).toBe(false);
    }
  });
});

describe("programStatusSchema", () => {
  it("accepts every schema-supported status", () => {
    for (const status of ["draft", "active", "inactive", "archived"]) {
      expect(programStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("rejects an unsupported status", () => {
    expect(programStatusSchema.safeParse({ status: "suspended" }).success).toBe(false);
  });
});
