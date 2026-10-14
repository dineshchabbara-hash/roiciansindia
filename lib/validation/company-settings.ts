import { z } from "zod";
import {
  GSTIN_PATTERN,
  SOCIAL_LINK_KEYS,
  isValidNumberFormat,
  type CompanySettingsInput,
  type SocialLinkKey,
} from "@/lib/domain/company-settings";

/**
 * Phase 21C Company Settings form (Super Admin). Mirrors the database
 * constraints added by 20260101000039 so a bad value is explained before the
 * round trip; RLS (Super Admin UPDATE only) and the constraints decide.
 * Country, tax and the logo are not part of this form.
 */

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

const httpsUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(300, `${label} must be at most 300 characters.`)
    .refine(
      (v) => v === "" || /^https:\/\/[^\s<>"']+$/i.test(v),
      `${label} must be a full https:// link.`,
    )
    .transform((v) => (v === "" ? null : v));

const numberFormat = (label: string) =>
  z
    .string()
    .trim()
    .refine(
      (v) => isValidNumberFormat(v),
      `${label} must use letters, digits, "-", "/" or "_", include exactly one {seq:N} (N from 4 to 12) and at most one {year}, and be 6–40 characters.`,
    );

export const companySettingsSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, "Enter the brand name.")
    .max(120, "Brand name must be at most 120 characters."),
  legalName: z
    .string()
    .trim()
    .min(1, "Enter the legal name.")
    .max(200, "Legal name must be at most 200 characters."),
  address: optionalText(500, "Address"),
  phone: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || /^[0-9+()\- ]{6,20}$/.test(v),
      "Enter a valid phone number.",
    )
    .transform((v) => (v === "" ? null : v)),
  email: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || z.email().safeParse(v).success,
      "Enter a valid email address.",
    )
    .transform((v) => (v === "" ? null : v.toLowerCase())),
  website: httpsUrl("Website"),
  gstin: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === "" || GSTIN_PATTERN.test(v), "Enter a valid 15-character GSTIN.")
    .transform((v) => (v === "" ? null : v)),
  receiptNumberFormat: numberFormat("Receipt number format"),
  certificateNumberFormat: numberFormat("Certificate number format"),
  certificateSignatoryName: optionalText(120, "Signatory name"),
  certificateSignatoryTitle: optionalText(120, "Signatory title"),
  socialLinks: z.object(
    Object.fromEntries(
      SOCIAL_LINK_KEYS.map((k) => [k, httpsUrl("Social link")]),
    ) as Record<SocialLinkKey, ReturnType<typeof httpsUrl>>,
  ),
});

export function parseCompanySettingsFormData(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return companySettingsSchema.safeParse({
    companyName: text("companyName"),
    legalName: text("legalName"),
    address: text("address"),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    gstin: text("gstin"),
    receiptNumberFormat: text("receiptNumberFormat"),
    certificateNumberFormat: text("certificateNumberFormat"),
    certificateSignatoryName: text("certificateSignatoryName"),
    certificateSignatoryTitle: text("certificateSignatoryTitle"),
    socialLinks: Object.fromEntries(
      SOCIAL_LINK_KEYS.map((k) => [k, text(`social_${k}`)]),
    ),
  });
}

/** Drops empty social links so the stored object only holds real links. */
export function toSettingsInput(
  parsed: z.infer<typeof companySettingsSchema>,
): CompanySettingsInput {
  const socialLinks: Partial<Record<SocialLinkKey, string>> = {};
  for (const key of SOCIAL_LINK_KEYS) {
    const value = parsed.socialLinks[key];
    if (value) socialLinks[key] = value;
  }
  return { ...parsed, socialLinks };
}
