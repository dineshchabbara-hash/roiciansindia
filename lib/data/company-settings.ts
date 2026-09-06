import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

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
