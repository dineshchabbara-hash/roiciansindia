"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin, isSuperAdmin } from "@/lib/domain/rbac";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  createAdminAccount,
  provisionStudentPortalAccess,
  setAdminAccountStatus,
} from "@/lib/data/accounts";
import {
  adminAccountSchema,
  adminStatusSchema,
  studentPortalAccessSchema,
} from "@/lib/validation/accounts";

/**
 * Phase 21C account actions.
 *  - Student portal access: Admin or Super Admin, for an existing student.
 *  - Admin accounts: Super Admin only; the role created is always "admin".
 * The browser submits identifiers and names only — never a role, a login
 * id or a password. Every account change is audited.
 */

export type AccountFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  message?: string;
};

export async function provisionStudentPortalAccessAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: "You are not authorized to give portal access." };
  }
  const parsed = studentPortalAccessSchema.safeParse({
    studentId: formData.get("studentId"),
  });
  if (!parsed.success) return { formError: parsed.error.issues[0]?.message };

  const result = await provisionStudentPortalAccess(parsed.data.studentId);
  if (!result.ok) return { formError: result.error };

  if (result.data.outcome === "linked") {
    await writeAuditLog({
      actorAuthUserId: ctx.authUserId,
      actorRole: ctx.role,
      action: "student.portal_access_granted",
      entityType: "student",
      entityId: parsed.data.studentId,
      after: { studentCode: result.data.studentCode, loginEmail: result.data.email },
    });
  }
  revalidatePath(`/admin/students/${parsed.data.studentId}`);
  return {
    message:
      result.data.outcome === "linked"
        ? `Portal access created for ${result.data.email}.`
        : "This student already has portal access.",
  };
}

export async function createAdminAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isSuperAdmin(ctx.role)) {
    return { formError: "Only a Super Admin can create admin accounts." };
  }
  const parsed = adminAccountSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (fieldErrors[String(issue.path[0])] ??= []).push(issue.message);
    }
    return { formError: "Check the highlighted fields.", fieldErrors };
  }

  const result = await createAdminAccount(parsed.data);
  if (!result.ok) return { formError: result.error };

  if (result.data.outcome === "created") {
    await writeAuditLog({
      actorAuthUserId: ctx.authUserId,
      actorRole: ctx.role,
      action: "admin_account.created",
      entityType: "admin_account",
      entityId: result.data.adminId,
      after: { email: result.data.email, roleLevel: "admin" },
    });
  }
  revalidatePath("/admin/admins");
  return {
    message:
      result.data.outcome === "created"
        ? `Admin account created for ${result.data.email}.`
        : `${result.data.email} already has an admin account.`,
  };
}

export async function setAdminAccountStatusAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isSuperAdmin(ctx.role)) {
    return { formError: "Only a Super Admin can change admin accounts." };
  }
  const parsed = adminStatusSchema.safeParse({
    adminId: formData.get("adminId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { formError: "Invalid request." };
  if (parsed.data.adminId === ctx.profileId) {
    return { formError: "You cannot change your own account." };
  }

  const result = await setAdminAccountStatus(parsed.data.adminId, parsed.data.status);
  if (!result.ok) return { formError: result.error };

  if (result.data.outcome === "updated") {
    await writeAuditLog({
      actorAuthUserId: ctx.authUserId,
      actorRole: ctx.role,
      action:
        parsed.data.status === "inactive"
          ? "admin_account.deactivated"
          : "admin_account.reactivated",
      entityType: "admin_account",
      entityId: parsed.data.adminId,
      after: { email: result.data.email, status: parsed.data.status },
    });
  }
  revalidatePath("/admin/admins");
  return {
    message:
      parsed.data.status === "inactive"
        ? "Admin account deactivated."
        : "Admin account reactivated.",
  };
}
