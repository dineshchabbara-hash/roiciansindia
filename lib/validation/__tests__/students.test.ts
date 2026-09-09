import { describe, expect, it } from "vitest";
import { studentProfileSchema, duplicateOverrideSchema } from "@/lib/validation/students";

const baseFields = {
  firstName: "Asha",
  lastName: "Rao",
  preferredName: "",
  email: "",
  phoneCountry: "IN",
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
  it("accepts a valid bare 10-digit India number (India selected) and normalizes it", () => {
    const result = studentProfileSchema.safeParse({ ...baseFields, phone: "9898595069" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+919898595069");
  });

  it("accepts a valid +91-prefixed, spaced India number and normalizes it", () => {
    const result = studentProfileSchema.safeParse({
      ...baseFields,
      phone: "+91 98985 95069",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+919898595069");
  });

  it("accepts a valid Canada number with Canada selected and normalizes it to E.164", () => {
    const result = studentProfileSchema.safeParse({
      ...baseFields,
      phoneCountry: "CA",
      phone: "416-555-1234",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+14165551234");
  });

  it("accepts a valid UK number with the UK selected and normalizes it to E.164", () => {
    const result = studentProfileSchema.safeParse({
      ...baseFields,
      phoneCountry: "GB",
      phone: "07911 123456",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+447911123456");
  });

  it("accepts a full E.164 number regardless of which country is selected", () => {
    // A "+" number is self-describing — the selector is only a fallback
    // hint for numbers without one.
    const result = studentProfileSchema.safeParse({
      ...baseFields,
      phoneCountry: "IN",
      phone: "+14165551234",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+14165551234");
  });

  it("rejects a 9-digit India number with a visible field error", () => {
    const result = studentProfileSchema.safeParse({ ...baseFields, phone: "987654321" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.phone?.[0]).toMatch(
        /valid phone number/i,
      );
    }
  });

  it("rejects an India subscriber number longer than 10 digits", () => {
    const result = studentProfileSchema.safeParse({
      ...baseFields,
      phone: "98765432109",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid international number (too short for the selected country)", () => {
    const result = studentProfileSchema.safeParse({
      ...baseFields,
      phoneCountry: "GB",
      phone: "79",
    });
    expect(result.success).toBe(false);
  });

  it("rejects alphabetic input rather than silently accepting it", () => {
    const result = studentProfileSchema.safeParse({ ...baseFields, phone: "98NOTANUM1" });
    expect(result.success).toBe(false);
  });

  it("falls back to the default country rather than failing when the selector value is missing", () => {
    const withoutCountry: Record<string, string> = { ...baseFields };
    delete withoutCountry.phoneCountry;
    const result = studentProfileSchema.safeParse({
      ...withoutCountry,
      phone: "9898595069",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+919898595069");
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
