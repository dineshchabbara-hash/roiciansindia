import { describe, expect, it } from "vitest";
import {
  GSTIN_PATTERN,
  diffSettings,
  isValidNumberFormat,
  previewNumber,
  type CompanySettingsInput,
} from "@/lib/domain/company-settings";

const base: CompanySettingsInput = {
  companyName: "Roicians Tech",
  legalName: "Roicians Tech Pvt. Ltd.",
  address: null,
  phone: null,
  email: null,
  website: null,
  gstin: null,
  receiptNumberFormat: "REC-{year}-{seq:6}",
  certificateNumberFormat: "CERT-{year}-{seq:6}",
  certificateSignatoryName: null,
  certificateSignatoryTitle: null,
  socialLinks: {},
};

describe("isValidNumberFormat (same rule as the database)", () => {
  it.each([
    "REC-{year}-{seq:6}",
    "CERT-{year}-{seq:6}",
    "RCPT/{seq:7}/{year}",
    "R_{seq:12}",
  ])("accepts %s", (format) => expect(isValidNumberFormat(format)).toBe(true));

  it.each([
    ["no sequence", "REC-{year}"],
    ["two sequences", "R-{seq:6}-{seq:6}"],
    ["two years", "{year}-{year}-{seq:6}"],
    ["width too small", "REC-{seq:3}"],
    ["width too large", "REC-{seq:13}"],
    ["unsafe characters", "REC <b>{seq:6}"],
    ["unknown token", "REC-{month}-{seq:6}"],
    ["too long", `${"A".repeat(35)}{seq:6}`],
  ])("rejects %s", (_label, format) => expect(isValidNumberFormat(format)).toBe(false));
});

describe("previewNumber", () => {
  it("renders the year and the zero-padded sequence", () => {
    expect(previewNumber("REC-{year}-{seq:6}", 2026, 245)).toBe("REC-2026-000245");
    expect(previewNumber("RCPT/{seq:7}/{year}", 2027, 1)).toBe("RCPT/0000001/2027");
  });
  it("shows a dash for an invalid format", () => {
    expect(previewNumber("REC-{year}", 2026, 1)).toBe("—");
  });
});

describe("GSTIN pattern", () => {
  it("accepts a well-formed GSTIN and rejects others", () => {
    expect(GSTIN_PATTERN.test("29ABCDE1234F1Z5")).toBe(true);
    expect(GSTIN_PATTERN.test("29abcde1234f1z5")).toBe(false);
    expect(GSTIN_PATTERN.test("29ABCDE1234F1X5")).toBe(false);
    expect(GSTIN_PATTERN.test("29ABCDE1234F1Z")).toBe(false);
  });
});

describe("diffSettings", () => {
  it("reports only changed fields with before/after values", () => {
    const diff = diffSettings(base, {
      ...base,
      address: "1 Road",
      socialLinks: { linkedin: "https://linkedin.com/company/x" },
    });
    expect(diff.changed).toEqual(["address", "socialLinks"]);
    expect(diff.before).toEqual({ address: null, socialLinks: {} });
    expect(diff.after).toEqual({
      address: "1 Road",
      socialLinks: { linkedin: "https://linkedin.com/company/x" },
    });
  });

  it("treats an unchanged save (including empty social links) as no change", () => {
    expect(diffSettings(base, { ...base, socialLinks: {} }).changed).toEqual([]);
  });
});
