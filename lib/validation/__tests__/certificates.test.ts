import { describe, expect, it } from "vitest";
import {
  issueCertificateSchema,
  parseIssueCertificateFormData,
  revokeCertificateSchema,
  parseRevokeCertificateFormData,
  reissueCertificateSchema,
  parseReissueCertificateFormData,
} from "@/lib/validation/certificates";

describe("issueCertificateSchema", () => {
  it("accepts a valid completion date", () => {
    const result = issueCertificateSchema.safeParse({ completionDate: "2026-01-15" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed completion date", () => {
    const result = issueCertificateSchema.safeParse({ completionDate: "01/15/2026" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing completion date", () => {
    const result = issueCertificateSchema.safeParse({ completionDate: "" });
    expect(result.success).toBe(false);
  });

  it("parses from FormData", () => {
    const formData = new FormData();
    formData.set("completionDate", "2026-02-01");
    const result = parseIssueCertificateFormData(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.completionDate).toBe("2026-02-01");
    }
  });
});

describe("revokeCertificateSchema", () => {
  it("accepts an empty reason as null", () => {
    const result = revokeCertificateSchema.safeParse({ revokedReason: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.revokedReason).toBeNull();
    }
  });

  it("accepts a provided reason, trimmed", () => {
    const result = revokeCertificateSchema.safeParse({ revokedReason: "  Found an error  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.revokedReason).toBe("Found an error");
    }
  });

  it("parses from FormData", () => {
    const formData = new FormData();
    formData.set("revokedReason", "Typo in name");
    const result = parseRevokeCertificateFormData(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.revokedReason).toBe("Typo in name");
    }
  });
});

describe("reissueCertificateSchema", () => {
  it("accepts an empty reason as null", () => {
    const result = reissueCertificateSchema.safeParse({ reason: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBeNull();
    }
  });

  it("parses from FormData", () => {
    const formData = new FormData();
    formData.set("reason", "Corrected spelling of student name");
    const result = parseReissueCertificateFormData(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe("Corrected spelling of student name");
    }
  });
});
