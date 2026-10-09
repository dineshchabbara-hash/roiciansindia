"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import { recordOfflinePayment } from "@/lib/data/payments";
import { writeAuditLog } from "@/lib/data/audit-log";
import { parseRecordOfflinePaymentFormData } from "@/lib/validation/payments";

/**
 * Phase 20A — record an offline payment (FR-90 / BR-6). Admin/Super Admin
 * only: re-checked here before anything else, and again inside
 * record_offline_payment() itself, which is the database's only end-user
 * write path into `payments`. No Trainer or Student path exists.
 *
 * Audit (existing writeAuditLog convention, action name from
 * DATABASE_SCHEMA.md's audit_logs example `payment.recorded_offline`): one
 * entry per payment actually created, with minimal metadata — no notes,
 * no reference text. An idempotent resubmission of the same form (the
 * database reports already_recorded) creates no second payment and no
 * second audit entry; it lands on the same payment page.
 */

const NOT_AUTHORIZED = "You are not authorized to record payments.";

export type RecordPaymentFormState = {
  formError?: string;
};

export async function recordOfflinePaymentAction(
  _prevState: RecordPaymentFormState,
  formData: FormData,
): Promise<RecordPaymentFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = parseRecordOfflinePaymentFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid payment." };
  }

  const result = await recordOfflinePayment(parsed.data);
  if (!result.ok) {
    return { formError: result.error };
  }

  if (!result.data.alreadyRecorded) {
    await writeAuditLog({
      actorAuthUserId: ctx.authUserId,
      actorRole: ctx.role,
      action: "payment.recorded_offline",
      entityType: "payment",
      entityId: result.data.id,
      after: {
        paymentCode: result.data.paymentCode,
        enrollmentId: parsed.data.enrollmentId,
        amount: parsed.data.amount,
        method: parsed.data.method,
        paymentType: parsed.data.paymentType,
        paidOn: parsed.data.paidOn,
      },
    });
  }

  revalidatePath("/admin/payments");
  revalidatePath(`/admin/enrollments/${parsed.data.enrollmentId}`);
  redirect(`/admin/payments/${result.data.id}?recorded=1`);
}
