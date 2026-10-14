/**
 * Phase 21C — Company Settings (FR-140 / FR-141). Pure.
 *
 * One `company_settings` row holds the company's identity for the whole
 * platform: the brand name for UI, the legal name for receipts and
 * certificates, contact details, GSTIN, numbering formats, the certificate
 * signatory and social links. Super Admin edits; Admin reads. Tax stays
 * disabled (FR-141 / DECISIONS_NEEDED D2): nothing in V1 calculates tax, so
 * the page shows the state and offers no switch that would do nothing.
 */

export const SOCIAL_LINK_KEYS = [
  "linkedin",
  "facebook",
  "instagram",
  "youtube",
  "x",
] as const;
export type SocialLinkKey = (typeof SOCIAL_LINK_KEYS)[number];

export const SOCIAL_LINK_LABELS: Record<SocialLinkKey, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X (Twitter)",
};

export type CompanySettings = {
  id: string;
  companyName: string;
  legalName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  country: string;
  gstin: string | null;
  taxEnabled: boolean;
  taxLabel: string;
  receiptNumberFormat: string;
  certificateNumberFormat: string;
  certificateSignatoryName: string | null;
  certificateSignatoryTitle: string | null;
  socialLinks: Partial<Record<SocialLinkKey, string>>;
  logoPath: string | null;
  updatedAt: string;
};

/** The fields a Super Admin edits on the Settings form (logo is separate). */
export const EDITABLE_SETTINGS_FIELDS = [
  "companyName",
  "legalName",
  "address",
  "phone",
  "email",
  "website",
  "gstin",
  "receiptNumberFormat",
  "certificateNumberFormat",
  "certificateSignatoryName",
  "certificateSignatoryTitle",
  "socialLinks",
] as const;
export type EditableSettingsField = (typeof EDITABLE_SETTINGS_FIELDS)[number];
export type CompanySettingsInput = Pick<CompanySettings, EditableSettingsField>;

export const MAX_LOGO_BYTES = 1024 * 1024;
export const MAX_LOGO_LABEL = "1 MB";

/** Indian GSTIN: state code, PAN, entity number, "Z", check character. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const FORMAT_CHARS = /^([A-Za-z0-9/_-]|\{year\}|\{seq:([4-9]|1[0-2])\})+$/;

/**
 * Same rule as the database's is_valid_number_format(): letters, digits,
 * "-", "/", "_", at most one {year}, exactly one {seq:N} (N 4–12),
 * 6–40 characters. The {seq:N} token is what keeps every number unique.
 */
export function isValidNumberFormat(format: string): boolean {
  if (format.length < 6 || format.length > 40) return false;
  if (!FORMAT_CHARS.test(format)) return false;
  if ((format.match(/\{seq:/g) ?? []).length !== 1) return false;
  if ((format.match(/\{year\}/g) ?? []).length > 1) return false;
  return true;
}

/** What a number in `format` looks like, for the Settings preview. */
export function previewNumber(format: string, year: number, sequence: number): string {
  if (!isValidNumberFormat(format)) return "—";
  return format
    .replace("{year}", String(year))
    .replace(/\{seq:(\d+)\}/, (_, width: string) =>
      String(sequence).padStart(Number(width), "0"),
    );
}

/**
 * The fields whose value changed, with before/after values, for the audit
 * entry. Company settings hold no secrets, so values are recorded as-is.
 */
export function diffSettings(
  before: CompanySettingsInput,
  after: CompanySettingsInput,
): {
  changed: EditableSettingsField[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
} {
  const changed: EditableSettingsField[] = [];
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};
  for (const field of EDITABLE_SETTINGS_FIELDS) {
    const a = JSON.stringify(normalizeForCompare(before[field]));
    const b = JSON.stringify(normalizeForCompare(after[field]));
    if (a !== b) {
      changed.push(field);
      beforeOut[field] = before[field] ?? null;
      afterOut[field] = after[field] ?? null;
    }
  }
  return { changed, before: beforeOut, after: afterOut };
}

function normalizeForCompare(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .sort(([x], [y]) => x.localeCompare(y)),
    );
  }
  return value ?? null;
}
