import {
  SOCIAL_LINK_KEYS,
  SOCIAL_LINK_LABELS,
  type CompanySettings,
} from "@/lib/domain/company-settings";

/**
 * Phase 21C — read-only Company Settings for Admin (FR-140: Admin reads,
 * Super Admin edits). No form, no action.
 */
export function CompanySettingsView({ settings }: { settings: CompanySettings }) {
  const rows: Array<[string, string | null]> = [
    ["Brand name", settings.companyName],
    ["Legal name", settings.legalName],
    ["Address", settings.address],
    ["Phone", settings.phone],
    ["Email", settings.email],
    ["Website", settings.website],
    ["GSTIN", settings.gstin],
    ["Receipt number format", settings.receiptNumberFormat],
    ["Certificate number format", settings.certificateNumberFormat],
    ["Signatory name", settings.certificateSignatoryName],
    ["Signatory title", settings.certificateSignatoryTitle],
    ...SOCIAL_LINK_KEYS.map(
      (key) =>
        [SOCIAL_LINK_LABELS[key], settings.socialLinks[key] ?? null] as [
          string,
          string | null,
        ],
    ),
  ];
  return (
    <dl
      aria-label="Company settings"
      className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2"
    >
      {rows.map(([term, value]) => (
        <div key={term}>
          <dt className="text-muted-foreground text-xs">{term}</dt>
          <dd className="break-words whitespace-pre-wrap">{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
