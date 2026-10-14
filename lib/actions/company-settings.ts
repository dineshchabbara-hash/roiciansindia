"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/domain/rbac";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  getCompanySettings,
  removeCompanyLogo,
  replaceCompanyLogo,
  updateCompanySettings,
} from "@/lib/data/company-settings";
import {
  MAX_LOGO_BYTES,
  MAX_LOGO_LABEL,
  diffSettings,
} from "@/lib/domain/company-settings";
import { checkImageUpload } from "@/lib/domain/images";
import {
  parseCompanySettingsFormData,
  toSettingsInput,
} from "@/lib/validation/company-settings";

/**
 * Phase 21C Company Settings actions. Super Admin only — checked here from
 * the session and again by RLS (company_settings UPDATE is Super Admin
 * only). Admin has a read-only page and no action. Every change is audited
 * with the changed fields (settings hold no secrets).
 */

const NOT_AUTHORIZED = "Only a Super Admin can change company settings.";

export type SettingsFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  message?: string;
  /** The submitted text, echoed back on an error so the form keeps it. */
  values?: Record<string, string>;
  /** Changes on every refused submit, so the form re-mounts with `values`. */
  attempt?: number;
};

function submittedText(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

function revalidateSettings() {
  revalidatePath("/admin/settings");
  revalidatePath("/admin", "layout");
}

export async function updateCompanySettingsAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isSuperAdmin(ctx.role)) return { formError: NOT_AUTHORIZED };

  const parsed = parseCompanySettingsFormData(formData);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key =
        issue.path[0] === "socialLinks"
          ? `social_${String(issue.path[1])}`
          : String(issue.path[0]);
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      formError: "Check the highlighted fields.",
      fieldErrors,
      values: submittedText(formData),
      attempt: Date.now(),
    };
  }
  const input = toSettingsInput(parsed.data);

  const current = await getCompanySettings();
  if (!current.ok) return { formError: current.error };

  const diff = diffSettings(current.data, input);
  if (diff.changed.length === 0) return { message: "No changes to save." };

  const saved = await updateCompanySettings(input);
  if (!saved.ok) {
    return {
      formError: saved.error,
      values: submittedText(formData),
      attempt: Date.now(),
    };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "company_settings.updated",
    entityType: "company_settings",
    entityId: saved.data.id,
    before: { fields: diff.changed, ...diff.before },
    after: { fields: diff.changed, ...diff.after },
  });

  revalidateSettings();
  return { message: "Company settings saved." };
}

export async function uploadCompanyLogoAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isSuperAdmin(ctx.role)) return { formError: NOT_AUTHORIZED };

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { formError: "Choose an image to upload." };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { formError: `The image is too large. Maximum size is ${MAX_LOGO_LABEL}.` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkImageUpload(bytes, MAX_LOGO_BYTES, MAX_LOGO_LABEL);
  if (!check.ok) return { formError: check.error };

  const stored = await replaceCompanyLogo(bytes, check.extension, check.contentType);
  if (!stored.ok) return { formError: stored.error };

  const settings = await getCompanySettings();
  if (settings.ok) {
    await writeAuditLog({
      actorAuthUserId: ctx.authUserId,
      actorRole: ctx.role,
      action: "company_settings.logo_updated",
      entityType: "company_settings",
      entityId: settings.data.id,
      before: { logoPath: stored.data.previousPath },
      after: { logoPath: stored.data.logoPath },
    });
  }

  revalidateSettings();
  return { message: "Logo updated." };
}

export async function removeCompanyLogoAction(
  _prev: SettingsFormState,
  _formData: FormData,
): Promise<SettingsFormState> {
  void _formData;
  const ctx = await getCurrentUserContext();
  if (!ctx || !isSuperAdmin(ctx.role)) return { formError: NOT_AUTHORIZED };

  const removed = await removeCompanyLogo();
  if (!removed.ok) return { formError: removed.error };
  if (!removed.data.previousPath) return { message: "There is no logo to remove." };

  const settings = await getCompanySettings();
  if (settings.ok) {
    await writeAuditLog({
      actorAuthUserId: ctx.authUserId,
      actorRole: ctx.role,
      action: "company_settings.logo_removed",
      entityType: "company_settings",
      entityId: settings.data.id,
      before: { logoPath: removed.data.previousPath },
      after: { logoPath: null },
    });
  }

  revalidateSettings();
  return { message: "Logo removed." };
}
