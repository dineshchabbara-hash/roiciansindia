import { describe, expect, it } from "vitest";
import {
  parseCompanySettingsFormData,
  toSettingsInput,
} from "@/lib/validation/company-settings";

function form(values: Record<string, string>) {
  const data = new FormData();
  const defaults: Record<string, string> = {
    companyName: "Roicians Tech",
    legalName: "Roicians Tech Pvt. Ltd.",
    receiptNumberFormat: "REC-{year}-{seq:6}",
    certificateNumberFormat: "CERT-{year}-{seq:6}",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...values })) data.set(k, v);
  return data;
}

describe("company settings form", () => {
  it("accepts a full, valid form and normalizes values", () => {
    const parsed = parseCompanySettingsFormData(
      form({
        address: " 12 MG Road, Bengaluru ",
        phone: "+91 98450 12345",
        email: "Hello@Roicians.Example",
        website: "https://roicians.example",
        gstin: "29abcde1234f1z5",
        certificateSignatoryName: "A. Director",
        social_linkedin: "https://linkedin.com/company/roicians",
        social_x: "",
      }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const input = toSettingsInput(parsed.data);
    expect(input).toMatchObject({
      address: "12 MG Road, Bengaluru",
      email: "hello@roicians.example",
      gstin: "29ABCDE1234F1Z5",
      certificateSignatoryTitle: null,
      socialLinks: { linkedin: "https://linkedin.com/company/roicians" },
    });
    expect(Object.keys(input.socialLinks)).toEqual(["linkedin"]);
  });

  it.each([
    ["blank brand name", { companyName: "  " }, "companyName"],
    ["blank legal name", { legalName: "" }, "legalName"],
    ["bad email", { email: "not-an-email" }, "email"],
    ["non-https website", { website: "http://roicians.example" }, "website"],
    ["javascript link", { social_facebook: "javascript:alert(1)" }, "socialLinks"],
    ["bad GSTIN", { gstin: "12345" }, "gstin"],
    [
      "format without sequence",
      { receiptNumberFormat: "REC-{year}" },
      "receiptNumberFormat",
    ],
    [
      "format with markup",
      { certificateNumberFormat: "<b>{seq:6}</b>" },
      "certificateNumberFormat",
    ],
    ["bad phone", { phone: "call me" }, "phone"],
  ])("rejects %s", (_label, values, field) => {
    const parsed = parseCompanySettingsFormData(form(values));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => String(i.path[0]))).toContain(field);
  });
});
