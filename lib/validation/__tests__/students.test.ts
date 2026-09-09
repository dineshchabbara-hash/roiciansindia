import { describe, expect, it } from "vitest";
import { studentProfileSchema, duplicateOverrideSchema } from "@/lib/validation/students";

const baseFields = {
  firstName: "Asha",
  lastName: "Rao",
  preferredName: "",
  email: "",
  alternatePhone: "",
  dateOfBirth: "",
  gender: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
};

describe("studentProfileSchema phone field", () => {
  it("accepts a valid bare 10-digit number and normalizes it to canonical form", () => {
    const result = studentProfileSchema.safeParse({ ...baseFields, phone: "9898595069" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+919898595069");
  });

  it("accepts a valid +91-prefixed, spaced number and normalizes it", () => {
    const result = studentProfileSchema.safeParse({
      ...baseFields,
      phone: "+91 98985 95069",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+919898595069");
  });

  it("rejects a 9-digit number with a visible field error", () => {
    const result = studentProfileSchema.safeParse({ ...baseFields, phone: "987654321" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.phone?.[0]).toMatch(/valid.*phone/i);
    }
  });

  it("rejects a subscriber number longer than 10 digits", () => {
    const result = studentProfileSchema.safeParse({
      ...baseFields,
      phone: "98765432109",
    });
    expect(result.success).toBe(false);
  });

  it("rejects alphabetic input rather than silently accepting it", () => {
    const result = studentProfileSchema.safeParse({ ...baseFields, phone: "98NOTANUM1" });
    expect(result.success).toBe(false);
  });
});

describe("duplicateOverrideSchema", () => {
  it("requires a reason of at least 5 characters", () => {
    expect(duplicateOverrideSchema.safeParse({ reason: "ok" }).success).toBe(false);
    expect(
      duplicateOverrideSchema.safeParse({ reason: "different person, shared phone" })
        .success,
    ).toBe(true);
  });
});
