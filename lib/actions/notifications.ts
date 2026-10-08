"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin, type Role } from "@/lib/domain/rbac";
import {
  markAllNotificationsReadRecord,
  markNotificationReadRecord,
  resolveNotificationRecipient,
  sendNotificationRecord,
} from "@/lib/data/notifications";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  parseNotificationIdFormData,
  parseSendNotificationFormData,
} from "@/lib/validation/notifications";

/**
 * Phase 18 V1 notification actions. Sending is Admin/Super Admin only; the
 * recipient is resolved server-side from a Student/Trainer profile id, and
 * the sender is always the authenticated caller (the DB insert policy
 * enforces created_by = auth.uid() as well). Mark-read actions only ever
 * touch the caller's own received notifications.
 */

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type SendNotificationFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<"recipient" | "title" | "body", string>>;
  success?: boolean;
};

export async function sendNotificationAction(
  _prevState: SendNotificationFormState,
  formData: FormData,
): Promise<SendNotificationFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) return { formError: NOT_AUTHORIZED };

  const parsed = parseSendNotificationFormData(formData);
  if (!parsed.success) {
    const fieldErrors: SendNotificationFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (
        (field === "recipient" || field === "title" || field === "body") &&
        !fieldErrors[field]
      ) {
        fieldErrors[field] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const recipient = await resolveNotificationRecipient(parsed.data.recipient);
  if (!recipient.ok) return { fieldErrors: { recipient: recipient.error } };

  const result = await sendNotificationRecord({
    senderAuthUserId: ctx.authUserId,
    recipientAuthUserId: recipient.data.authUserId,
    title: parsed.data.title,
    body: parsed.data.body,
  });
  if (!result.ok) return { formError: result.error };

  // Minimal audit payload: who received it and what kind of account they
  // hold — never the title or message text.
  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "notification.send",
    entityType: "notification",
    entityId: result.data.id,
    after: {
      recipientAuthUserId: recipient.data.authUserId,
      recipientKind: recipient.data.kind,
    },
  });

  revalidatePath("/admin/notifications");
  return { success: true };
}

function portalPathFor(role: Role): string | null {
  if (role === "student") return "/student";
  if (role === "trainer") return "/trainer";
  return null;
}

export type MarkNotificationFormState = { formError?: string };

export async function markNotificationReadAction(
  _prevState: MarkNotificationFormState,
  formData: FormData,
): Promise<MarkNotificationFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx) return { formError: NOT_AUTHORIZED };
  const portalPath = portalPathFor(ctx.role);
  if (!portalPath) return { formError: NOT_AUTHORIZED };

  const notificationId = parseNotificationIdFormData(formData);
  if (!notificationId) return { formError: "Notification not found." };

  const result = await markNotificationReadRecord({
    notificationId,
    recipientAuthUserId: ctx.authUserId,
  });
  if (!result.ok) return { formError: result.error };

  revalidatePath(portalPath, "layout");
  return {};
}

export async function markAllNotificationsReadAction(): Promise<MarkNotificationFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx) return { formError: NOT_AUTHORIZED };
  const portalPath = portalPathFor(ctx.role);
  if (!portalPath) return { formError: NOT_AUTHORIZED };

  const result = await markAllNotificationsReadRecord(ctx.authUserId);
  if (!result.ok) return { formError: result.error };

  revalidatePath(portalPath, "layout");
  return {};
}
