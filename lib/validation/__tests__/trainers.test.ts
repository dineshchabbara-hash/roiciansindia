import { describe, expect, it } from "vitest";
import { trainerProfileSchema, trainerStatusSchema } from "@/lib/validation/trainers";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Asha",
    lastName: "Rao",
    email: "asha.rao@example.com",
    phoneCountry: "IN",
    phone: "",
    bio: "",
    specialization: "",
    ...overrides,
  };
}

describe("trainerProfileSchema", () => {
  it("accepts a valid trainer with no phone at all — trainers.phone is nullable", () => {
    const result = trainerProfileSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBeNull();
      expect(result.data.specialization).toEqual([]);
    }
  });

  it("requires a first name", () => {
    const result = trainerProfileSchema.safeParse(baseInput({ firstName: "" }));
    expect(result.success).toBe(false);
  });

  it("requires a valid email", () => {
    const result = trainerProfileSchema.safeParse(baseInput({ email: "not-an-email" }));
    expect(result.success).toBe(false);
  });

  it("requires email to be present at all (unlike students, where it's optional)", () => {
    const result = trainerProfileSchema.safeParse(baseInput({ email: "" }));
    expect(result.success).toBe(false);
  });

  it("normalizes a bare national number using the selected country", () => {
    const result = trainerProfileSchema.safeParse(
      baseInput({ phoneCountry: "IN", phone: "9876543210" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+919876543210");
  });

  it("handles a leading-+ international number regardless of the selected country", () => {
    const result = trainerProfileSchema.safeParse(
      baseInput({ phoneCountry: "IN", phone: "+14165556002" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+14165556002");
  });

  it("rejects an invalid phone number with a visible field error", () => {
    const result = trainerProfileSchema.safeParse(baseInput({ phone: "123" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.phone?.[0]).toMatch(/valid phone/i);
    }
  });

  it("never assumes a universal 10-digit number — a 10-digit US-shaped number under India is invalid unless it's a real Indian number", () => {
    // 10 digits, but not a real Indian mobile/landline number shape.
    const result = trainerProfileSchema.safeParse(
      baseInput({ phoneCountry: "IN", phone: "0000000000" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a tampered/unsupported country code with a visible error, never a silent fallback", () => {
    const result = trainerProfileSchema.safeParse(baseInput({ phoneCountry: "ZZ" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.phoneCountry?.[0]).toMatch(
        /valid country/i,
      );
    }
  });

  it("falls back to the default country when phoneCountry is genuinely absent", () => {
    const result = trainerProfileSchema.safeParse(
      baseInput({ phoneCountry: undefined, phone: "9876543210" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+919876543210");
  });

  it("parses a comma-separated specialization list into an array", () => {
    const result = trainerProfileSchema.safeParse(
      baseInput({ specialization: "React, Node.js" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.specialization).toEqual(["React", "Node.js"]);
  });

  it("treats blank bio as null, not an empty string", () => {
    const result = trainerProfileSchema.safeParse(baseInput({ bio: "" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.bio).toBeNull();
  });
});

describe("trainerStatusSchema", () => {
  it.each(["active", "inactive"])("accepts %s", (status) => {
    expect(trainerStatusSchema.safeParse({ status }).success).toBe(true);
  });

  it("rejects 'archived' — trainers have no archived status", () => {
    expect(trainerStatusSchema.safeParse({ status: "archived" }).success).toBe(false);
  });
});
