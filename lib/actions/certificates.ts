"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import {
  issueCertificateRecord,
  revokeCertificateRecord,
  reissueCertificateRecord,
  getCertificateDownloadUrl,
  verifyCertificatePublic,
} from "@/lib/data/certificates";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  parseIssueCertificateFormData,
  parseRevokeCertificateFormData,
  parseReissueCertificateFormData,
} from "@/lib/validation/certificates";
import type { PublicCertificateVerification } from "@/lib/domain/certificates";

/**
 * Certificates server actions (Phase 17). Admin/Super Admin only for
 * issue/revoke/reissue, matching certificates_write_admin/_update_admin
 * RLS exactly (USER_ROLES_AND_PERMISSIONS.md: Trainer "–" on certificates
 * — no Trainer path exists in this file at all, same discipline as
 * lib/actions/assignments.ts having no Trainer-authored assignment-delete
 * action because no such RLS policy exists). The download-URL action is
 * shared (Admin/Student both call it); public verification has no
 * authentication at all by design (FR-101) and is rate-limited instead.
 */

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type CertificateFormState = {
  formError?: string;
  success?: boolean;
};

export async function issueCertificateAction(
  enrollmentId: string,
  _prevState: CertificateFormState,
  formData: FormData,
): Promise<CertificateFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) return { formError: NOT_AUTHORIZED };

  const parsed = parseIssueCertificateFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid completion date." };
  }

  const result = await issueCertificateRecord({
    enrollmentId,
    completionDate: parsed.data.completionDate,
  });
  if (!result.ok) return { formError: result.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "certificate.issue",
    entityType: "certificate",
    entityId: result.data.id,
    after: { enrollmentId, certificateNumber: result.data.certificateNumber },
  });

  revalidatePath(`/admin/enrollments/${enrollmentId}`);
  return { success: true };
}

export async function revokeCertificateAction(
  certificateId: string,
  enrollmentId: string,
  _prevState: CertificateFormState,
  formData: FormData,
): Promise<CertificateFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) return { formError: NOT_AUTHORIZED };

  const parsed = parseRevokeCertificateFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid reason." };
  }

  const revokedReason = parsed.data.revokedReason ?? null;
  const result = await revokeCertificateRecord({
    certificateId,
    revokedReason,
  });
  if (!result.ok) return { formError: result.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "certificate.revoke",
    entityType: "certificate",
    entityId: certificateId,
    after: { revokedReason },
  });

  revalidatePath(`/admin/enrollments/${enrollmentId}`);
  return { success: true };
}

export async function reissueCertificateAction(
  originalCertificateId: string,
  enrollmentId: string,
  _prevState: CertificateFormState,
  formData: FormData,
): Promise<CertificateFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) return { formError: NOT_AUTHORIZED };

  const parsed = parseReissueCertificateFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid reason." };
  }

  const reason = parsed.data.reason ?? null;
  const result = await reissueCertificateRecord({
    originalCertificateId,
    reason,
  });
  if (!result.ok) return { formError: result.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "certificate.reissue",
    entityType: "certificate",
    entityId: result.data.id,
    before: { originalCertificateId },
    after: { enrollmentId, certificateNumber: result.data.certificateNumber, reason },
  });

  revalidatePath(`/admin/enrollments/${enrollmentId}`);
  return { success: true };
}

/**
 * Shared "Download certificate" action — Admin and Student both call
 * this. Authorization is entirely lib/data/certificates.ts's own
 * getCertificateDownloadUrl, which re-fetches the certificate through the
 * caller's own RLS-scoped session first (certificates_select_admin/
 * _select_own) and only then mints a signed URL through that same
 * session — same pattern as getAssignmentAttachmentUrlAction.
 */
export async function getCertificateDownloadUrlAction(
  certificateId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ctx = await getCurrentUserContext();
  if (!ctx) return { ok: false, error: NOT_AUTHORIZED };

  const result = await getCertificateDownloadUrl(certificateId);
  if (!result.ok) return result;
  return { ok: true, url: result.data.url };
}

// ---------------------------------------------------------------------------
// Public verification (FR-101/AD-L-006). No session check — this endpoint
// is intentionally anonymous. Rate-limited by IP (SECURITY_PLAN.md §11:
// "prevents brute-forcing certificate numbers to enumerate student
// names"), reusing the same lib/auth/rate-limit.ts backend already used
// for /login and /forgot-password rather than adding a second rate-limit
// mechanism. A generic "not found" result for an unknown number and for a
// rate-limited request alike never reveals which certificate numbers are
// real.

const VERIFY_RATE_LIMIT = { limit: 10, windowSeconds: 60 };

async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return h.get("x-real-ip") ?? "unknown";
}

export type VerifyCertificateState = {
  formError?: string;
  result?: PublicCertificateVerification | null;
  checked?: boolean;
};

export async function verifyCertificateAction(
  _prevState: VerifyCertificateState,
  formData: FormData,
): Promise<VerifyCertificateState> {
  const certificateNumber =
    (formData.get("certificateNumber") as string | null)?.trim() ?? "";
  if (!certificateNumber) {
    return { formError: "Enter a certificate number." };
  }

  const ip = await getClientIp();
  const rateLimit = await checkRateLimit(`verify-certificate:${ip}`, VERIFY_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return { formError: "Too many attempts. Please try again in a few minutes." };
  }

  const result = await verifyCertificatePublic(certificateNumber);
  if (!result.ok) return { formError: result.error };

  return { checked: true, result: result.data };
}
