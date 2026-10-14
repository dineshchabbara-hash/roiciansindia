import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompanySettingsForm } from "@/components/admin/settings/company-settings-form";
import { CompanyLogoForm } from "@/components/admin/settings/company-logo-form";
import { CompanySettingsView } from "@/components/admin/settings/company-settings-view";
import { getCurrentUserContext } from "@/lib/auth/session";
import { companyLogoUrl, getCompanySettings } from "@/lib/data/company-settings";
import { isAdminOrSuperAdmin, isSuperAdmin, roleHomePath } from "@/lib/domain/rbac";

export const dynamic = "force-dynamic";

/**
 * Phase 21C — Company Settings (FR-140 / FR-141). Super Admin edits; Admin
 * sees the same values read-only. Receipts and certificates read these
 * values server-side when they are issued.
 */
export default async function SettingsPage() {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));
  const canEdit = isSuperAdmin(user.role);

  const result = await getCompanySettings();
  if (!result.ok) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }
  const settings = result.data;
  const logoUrl = companyLogoUrl(settings.logoPath);
  const year = Number(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
    }).format(new Date()),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Company Settings</h1>
        <p className="text-muted-foreground text-sm">
          {canEdit
            ? "Company identity used across the portals, receipts and certificates."
            : "Read-only — only a Super Admin can change company settings."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2 className="text-base">Company details</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <CompanySettingsForm settings={settings} year={year} />
          ) : (
            <CompanySettingsView settings={settings} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2 className="text-base">Logo</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <CompanyLogoForm logoUrl={logoUrl} />
          ) : logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- public branding asset
            <img
              src={logoUrl}
              alt="Current company logo"
              className="h-16 w-auto rounded border bg-white p-1"
            />
          ) : (
            <p className="text-muted-foreground text-sm">No logo uploaded.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2 className="text-base">Country &amp; tax</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl
            aria-label="Country and tax"
            className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2"
          >
            <div>
              <dt className="text-muted-foreground text-xs">Country</dt>
              <dd>{settings.country}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Tax</dt>
              <dd>{settings.taxEnabled ? `${settings.taxLabel} enabled` : "Disabled"}</dd>
            </div>
          </dl>
          <p className="text-muted-foreground mt-3 text-xs">
            Tax calculation is not enabled in this version: receipts carry no tax line.
            Enabling {settings.taxLabel} needs a confirmed rate (DECISIONS_NEEDED D2) and
            is not a setting yet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
