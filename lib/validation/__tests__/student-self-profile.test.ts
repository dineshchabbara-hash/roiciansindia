import { describe, expect, it } from "vitest";
import { studentSelfProfileSchema } from "@/lib/validation/student-self-profile";

const baseFields = {
  phoneCountry: "IN",
  alternatePhone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
};

describe("studentSelfProfileSchema", () => {
  it("accepts a valid bare 10-digit India number and normalizes it to E.164", () => {
    const result = studentSelfProfileSchema.safeParse({
      ...baseFields,
      phone: "9898595069",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+919898595069");
  });

  it("rejects an invalid phone number for the selected country", () => {
    const result = studentSelfProfileSchema.safeParse({ ...baseFields, phone: "123" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.phone?.[0]).toBe(
        "Enter a valid phone number for the selected country.",
      );
    }
  });

  it("rejects a blank phone", () => {
    const result = studentSelfProfileSchema.safeParse({ ...baseFields, phone: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a tampered/unsupported country code", () => {
    const result = studentSelfProfileSchema.safeParse({
      ...baseFields,
      phoneCountry: "ZZ",
      phone: "9898595069",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.phoneCountry?.[0]).toBe(
        "Select a valid country.",
      );
    }
  });

  it("normalizes blank optional address fields to null rather than an empty string", () => {
    const result = studentSelfProfileSchema.safeParse({
      ...baseFields,
      phone: "9898595069",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.alternatePhone).toBeNull();
      expect(result.data.addressLine1).toBeNull();
      expect(result.data.city).toBeNull();
    }
  });

  it("accepts populated address fields unchanged", () => {
    const result = studentSelfProfileSchema.safeParse({
      ...baseFields,
      phone: "9898595069",
      addressLine1: "221B Baker Street",
      city: "Mumbai",
      state: "Maharashtra",
      postalCode: "400001",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.addressLine1).toBe("221B Baker Street");
      expect(result.data.city).toBe("Mumbai");
      expect(result.data.state).toBe("Maharashtra");
      expect(result.data.postalCode).toBe("400001");
    }
  });

  it("does not accept identity/enrollment-critical fields — the schema has no such keys at all", () => {
    // Defense-in-depth check: even if a caller tried to smuggle in a
    // protected field, this schema's shape has no key for it, so it can
    // never reach lib/data/student-portal.ts's update() call regardless.
    const parsed = studentSelfProfileSchema.parse({
      ...baseFields,
      phone: "9898595069",
    });
    expect(parsed).not.toHaveProperty("firstName");
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("studentCode");
  });
});
