"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  initiateRazorpayRefund,
  recordOfflineRefund,
  syncRazorpayRefund,
} from "@/lib/data/refunds";
import {
  parseInitiateRazorpayRefundFormData,
  parseRecordOfflineRefundFormData,
} from "@/lib/validation/refunds";

/**
 * Phase 21B refund actions — FR-97, SEC-10. Admin / Super Admin only:
 * re-checked here before anything else and again inside the database
 * functions. No Student, Trainer or anonymous path exists. There is no
 * approval step (checkpoint decision).
 *
 * A refund records money returned; it never changes the payment, the
 * enrollment's payable/fee/discount or any installment.
 *
 * Audit (existing writeAuditLog convention): `refund.recorded_offline` and
 * `refund.initiated` from here, once per refund actually created — an
 * idempotent resubmission of the same form writes nothing. Razorpay's
 * outcome is audited by the database itself (`refund.processed` /
 * `refund.failed`, system actor, once per transition). Never the reason
 * text beyond its presence, never provider payloads or secrets.
 */

const NOT_AUTHORIZED = "You are not authorized to refund payments.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RefundFormState = {
  formError?: string;
  message?: string;
};

function revalidatePayment(paymentId: string) {
  revalidatePath(`/admin/payments/${paymentId}`);
  revalidatePath("/admin/payments");
}

export async function recordOfflineRefundAction(
  _prevState: RefundFormState,
  formData: FormData,
): Promise<RefundFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) return { formError: NOT_AUTHORIZED };

  const parsed = parseRecordOfflineRefundFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid refund." };
  }

  const result = await recordOfflineRefund(parsed.data);
  if (!result.ok) return { formError: result.error };

  if (!result.data.alreadyRecorded) {
    await writeAuditLog({
      actorAuthUserId: ctx.authUserId,
      actorRole: ctx.role,
      action: "refund.recorded_offline",
      entityType: "refund",
      entityId: result.data.id,
      after: {
        paymentId: parsed.data.paymentId,
        amount: parsed.data.amount,
        refundedOn: parsed.data.refundedOn,
        status: "processed",
      },
    });
  }

  revalidatePayment(parsed.data.paymentId);
  return { message: `Refund of ₹${parsed.data.amount} recorded.` };
}

export async function initiateRazorpayRefundAction(
  _prevState: RefundFormState,
  formData: FormData,
): Promise<RefundFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) return { formError: NOT_AUTHORIZED };

  const parsed = parseInitiateRazorpayRefundFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid refund." };
  }

  const result = await initiateRazorpayRefund(parsed.data);
  if (!result.ok) {
    revalidatePayment(parsed.data.paymentId);
    return { formError: result.error };
  }

  if (!result.data.alreadyReserved) {
    await writeAuditLog({
      actorAuthUserId: ctx.authUserId,
      actorRole: ctx.role,
      action: "refund.initiated",
      entityType: "refund",
      entityId: result.data.id,
      after: {
        paymentId: parsed.data.paymentId,
        amount: parsed.data.amount,
        channel: "razorpay",
      },
    });
  }

  revalidatePayment(parsed.data.paymentId);
  if (result.data.status === "processed") {
    return { message: `Refund of ₹${parsed.data.amount} processed by Razorpay.` };
  }
  if (result.data.status === "failed") {
    return {
      formError: "Razorpay could not process this refund. No money was refunded.",
    };
  }
  return {
    message: `Refund of ₹${parsed.data.amount} sent to Razorpay — awaiting Razorpay's confirmation. The balance changes only once it is processed.`,
  };
}

export async function syncRazorpayRefundAction(
  _prevState: RefundFormState,
  formData: FormData,
): Promise<RefundFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) return { formError: NOT_AUTHORIZED };

  const refundId = formData.get("refundId");
  const paymentId = formData.get("paymentId");
  if (
    typeof refundId !== "string" ||
    !UUID_PATTERN.test(refundId) ||
    typeof paymentId !== "string" ||
    !UUID_PATTERN.test(paymentId)
  ) {
    return { formError: "Invalid refund." };
  }

  const result = await syncRazorpayRefund(refundId);
  revalidatePayment(paymentId);
  if (!result.ok) return { formError: result.error };
  if (result.data.status === "initiated") {
    return { message: "Razorpay has not confirmed this refund yet." };
  }
  return {
    message:
      result.data.status === "processed"
        ? "Razorpay confirmed the refund."
        : "This refund did not go through. No money was refunded.",
  };
}
