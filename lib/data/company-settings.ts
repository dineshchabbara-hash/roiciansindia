import "server-only";

import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DataResult } from "@/lib/data/dashboard";
import {
  SOCIAL_LINK_KEYS,
  type CompanySettings,
  type CompanySettingsInput,
  type SocialLinkKey,
} from "@/lib/domain/company-settings";
import type { ImageExtension } from "@/lib/domain/images";

/**
 * Phase 21C — Company Settings (FR-140/FR-141).
 *
 * Reads and updates run through the viewer's own session, so RLS decides:
 * Admin/Super Admin SELECT, Super Admin UPDATE, nobody else anything. Only
 * the logo bytes go through the service role (the `branding` bucket has no
 * end-user write policy), always after the caller's Super Admin check, and
 * the row's logo_path is then set through the Super Admin's own session.
 *
 * Receipts and certificates keep reading company_settings with the service
 * role exactly as before; nothing here changes how they do it.
 */

export type CompanyBranding = {
  companyName: string;
  legalName: string;
};

// Last-resort fallback only, used solely when the company_settings read
// itself fails (e.g. connectivity issue) — never the primary source. The
// primary source is always the company_settings row itself
// (REQUIREMENTS.md FR-140); this fallback exists so the admin shell can
// still render its header rather than crash if that one query fails.
const FALLBACK_BRANDING: CompanyBranding = {
  companyName: "Roicians Tech",
  legalName: "Roicians Tech Pvt. Ltd.",
};

export async function getCompanyBranding(): Promise<CompanyBranding> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("company_settings")
      .select("company_name, legal_name")
      .maybeSingle();

    if (error || !data) {
      return FALLBACK_BRANDING;
    }

    return { companyName: data.company_name, legalName: data.legal_name };
  } catch {
    return FALLBACK_BRANDING;
  }
}

export const BRANDING_BUCKET = "branding";

const SETTINGS_SELECT =
  "id, company_name, legal_name, address, phone, email, website, country, gstin, tax_enabled, tax_label, receipt_number_format, certificate_number_format, certificate_signatory_name, certificate_signatory_title, social_links, logo_path, updated_at";

type SettingsRow = {
  id: string;
  company_name: string;
  legal_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  country: string;
  gstin: string | null;
  tax_enabled: boolean;
  tax_label: string;
  receipt_number_format: string;
  certificate_number_format: string;
  certificate_signatory_name: string | null;
  certificate_signatory_title: string | null;
  social_links: unknown;
  logo_path: string | null;
  updated_at: string;
};

function log(message: string, error?: unknown) {
  if (error === undefined) console.error(`[company-settings] ${message}`);
  else console.error(`[company-settings] ${message}:`, error);
}

function toSocialLinks(value: unknown): Partial<Record<SocialLinkKey, string>> {
  const out: Partial<Record<SocialLinkKey, string>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const key of SOCIAL_LINK_KEYS) {
    const link = (value as Record<string, unknown>)[key];
    if (typeof link === "string" && link) out[key] = link;
  }
  return out;
}

function toSettings(row: SettingsRow): CompanySettings {
  return {
    id: row.id,
    companyName: row.company_name,
    legalName: row.legal_name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    country: row.country,
    gstin: row.gstin,
    taxEnabled: row.tax_enabled,
    taxLabel: row.tax_label,
    receiptNumberFormat: row.receipt_number_format,
    certificateNumberFormat: row.certificate_number_format,
    certificateSignatoryName: row.certificate_signatory_name,
    certificateSignatoryTitle: row.certificate_signatory_title,
    socialLinks: toSocialLinks(row.social_links),
    logoPath: row.logo_path,
    updatedAt: row.updated_at,
  };
}

/** The settings row as the caller's RLS allows (Admin/Super Admin only). */
export async function getCompanySettings(): Promise<DataResult<CompanySettings>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("company_settings")
      .select(SETTINGS_SELECT)
      .eq("singleton", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "Company settings are not available." };
    return { ok: true, data: toSettings(data as SettingsRow) };
  } catch (error) {
    log("Could not load company settings", error);
    return { ok: false, error: "Could not load company settings." };
  }
}

/** Public URL of the stored logo (the branding bucket is public). */
export function companyLogoUrl(logoPath: string | null): string | null {
  if (!logoPath) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${BRANDING_BUCKET}/${logoPath}`;
}

/**
 * Saves the editable fields through the caller's session. Zero rows updated
 * means RLS refused (not a Super Admin) — reported, never silently ignored.
 */
export async function updateCompanySettings(
  input: CompanySettingsInput,
): Promise<DataResult<CompanySettings>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("company_settings")
      .update({
        company_name: input.companyName,
        legal_name: input.legalName,
        address: input.address,
        phone: input.phone,
        email: input.email,
        website: input.website,
        gstin: input.gstin,
        receipt_number_format: input.receiptNumberFormat,
        certificate_number_format: input.certificateNumberFormat,
        certificate_signatory_name: input.certificateSignatoryName,
        certificate_signatory_title: input.certificateSignatoryTitle,
        social_links: input.socialLinks,
      })
      .eq("singleton", true)
      .select(SETTINGS_SELECT);
    if (error) {
      if (error.code === "23514") {
        return {
          ok: false,
          error:
            "One of the values is not valid. Check the highlighted rules and try again.",
        };
      }
      throw error;
    }
    const row = (data as SettingsRow[] | null)?.[0];
    if (!row)
      return { ok: false, error: "You are not authorized to change company settings." };
    return { ok: true, data: toSettings(row) };
  } catch (error) {
    log("Could not save company settings", error);
    return { ok: false, error: "Could not save company settings. Please try again." };
  }
}

/**
 * Stores a new logo: uploads the (already validated) bytes, points the row
 * at it through the caller's session, then removes the previous object. A
 * failed row update removes the new object again, so nothing is orphaned.
 */
export async function replaceCompanyLogo(
  bytes: Uint8Array,
  extension: ImageExtension,
  contentType: string,
): Promise<DataResult<{ logoPath: string; previousPath: string | null }>> {
  const admin = createSupabaseAdminClient();
  const path = `logo/${randomUUID()}.${extension}`;
  try {
    const current = await getCompanySettings();
    if (!current.ok) return current;

    const { error: uploadError } = await admin.storage
      .from(BRANDING_BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (uploadError) throw uploadError;

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("company_settings")
      .update({ logo_path: path })
      .eq("singleton", true)
      .select("id");
    if (error || !data?.length) {
      await admin.storage.from(BRANDING_BUCKET).remove([path]);
      if (error) throw error;
      return { ok: false, error: "You are not authorized to change company settings." };
    }

    const previousPath = current.data.logoPath;
    if (previousPath && previousPath !== path) {
      const { error: removeError } = await admin.storage
        .from(BRANDING_BUCKET)
        .remove([previousPath]);
      if (removeError) log("Could not remove the previous logo object", removeError);
    }
    return { ok: true, data: { logoPath: path, previousPath } };
  } catch (error) {
    log("Could not store the logo", error);
    return { ok: false, error: "Could not upload the logo. Please try again." };
  }
}

/** Clears the logo (row first, then the object). */
export async function removeCompanyLogo(): Promise<
  DataResult<{ previousPath: string | null }>
> {
  try {
    const current = await getCompanySettings();
    if (!current.ok) return current;
    const previousPath = current.data.logoPath;
    if (!previousPath) return { ok: true, data: { previousPath: null } };

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("company_settings")
      .update({ logo_path: null })
      .eq("singleton", true)
      .select("id");
    if (error) throw error;
    if (!data?.length) {
      return { ok: false, error: "You are not authorized to change company settings." };
    }
    const { error: removeError } = await createSupabaseAdminClient()
      .storage.from(BRANDING_BUCKET)
      .remove([previousPath]);
    if (removeError) log("Could not remove the logo object", removeError);
    return { ok: true, data: { previousPath } };
  } catch (error) {
    log("Could not remove the logo", error);
    return { ok: false, error: "Could not remove the logo. Please try again." };
  }
}
