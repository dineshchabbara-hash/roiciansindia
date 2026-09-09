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

  it("accepts a valid UAE number with the UAE selected and normalizes it to E.164", () => {
    const result = studentProfileSchema.safeParse({
      ...baseFields,
      phoneCountry: "AE",
      phone: "050 123 4567",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+971501234567");
  });

  it("accepts a number formatted with parentheses and dashes", () => {
    const result = studentProfileSchema.safeParse({
      ...baseFields,
      phoneCountry: "CA",
      phone: "(416) 555-1234",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+14165551234");
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

  it("falls back to the default country rather than failing when the selector value is genuinely missing", () => {
    const withoutCountry: Record<string, string> = { ...baseFields };
    delete withoutCountry.phoneCountry;
    const result = studentProfileSchema.safeParse({
      ...withoutCountry,
      phone: "9898595069",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+919898595069");
  });

  it("rejects a tampered/invalid country code with a visible error, never a silent fallback to India", () => {
    // Simulates a request that didn't come from the rendered <select> (which
    // only ever offers real country codes) — the server must not trust the
    // value just because it looks like it came from the form.
    const result = studentProfileSchema.safeParse({
      ...baseFields,
      phoneCountry: "ZZ",
      phone: "9898595069",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.phoneCountry?.[0]).toMatch(
        /valid country/i,
      );
      // And critically: the phone itself must NOT have been silently
      // accepted as if India had been assumed.
      expect(result.error.flatten().fieldErrors.phone).toBeUndefined();
    }
  });

  it("rejects a non-country-code garbage value the same way", () => {
    const result = studentProfileSchema.safeParse({
      ...baseFields,
      phoneCountry: "<script>",
      phone: "9898595069",
    });
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
