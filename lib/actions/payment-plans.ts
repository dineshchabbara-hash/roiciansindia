"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import {
  addInstallmentToPlan,
  createPaymentPlanForEnrollment,
  editInstallment,
  removeInstallment,
  waiveInstallment,
} from "@/lib/data/payment-plans";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  parseCreatePaymentPlanFormData,
  parseInstallmentLineFormData,
} from "@/lib/validation/payment-plans";

/**
 * Admin-facing Payment Plan server actions (Phase 14). Re-checks
 * isAdminOrSuperAdmin() server-side before calling into
 * lib/data/payment-plans.ts, the same pattern lib/actions/enrollments.ts and
 * lib/actions/attendance.ts already establish — every mutation is
 * server-authorized, never relying on UI hiding. No Student or Trainer path
 * exists in this file at all: Student access is read-only
 * (getMyPaymentPlanForEnrollment, lib/data/student-portal.ts), and Trainer
 * has zero access to financial data by design.
 *
 * Each mutation is its own small, independently-submittable action (create
 * plan, add one installment, edit one installment, waive one installment,
 * remove one installment) — matching this codebase's established
 * one-control-per-form convention (EnrollmentStatusControl,
 * EnrollmentBatchAssignmentControl) rather than one large multi-row form.
 * payment_plans.total_amount is never a submitted field anywhere here — it
 * is always recomputed server-side (lib/data/payment-plans.ts's
 * recomputePlanTotal) after create/add/edit/remove.
 *
 * Minimal audit metadata only (ids and the changed amount/due date, never a
 * full row dump) — same discipline as lib/actions/enrollments.ts's own
 * writeAuditLog calls.
 */

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type PaymentPlanFormState = {
  formError?: string;
  success?: boolean;
};

export async function createPaymentPlanAction(
  enrollmentId: string,
  _prevState: PaymentPlanFormState,
  formData: FormData,
): Promise<PaymentPlanFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = parseCreatePaymentPlanFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid payment plan." };
  }

  const result = await createPaymentPlanForEnrollment(enrollmentId, parsed.data);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "payment_plan.create",
    entityType: "payment_plan",
    entityId: result.data.id,
    after: {
      enrollmentId,
      installmentCount: parsed.data.installments.length,
    },
  });

  revalidatePath(`/admin/enrollments/${enrollmentId}`);
  return { success: true };
}

export async function addInstallmentAction(
  planId: string,
  enrollmentId: string,
  _prevState: PaymentPlanFormState,
  formData: FormData,
): Promise<PaymentPlanFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = parseInstallmentLineFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid installment." };
  }

  const result = await addInstallmentToPlan(planId, parsed.data);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "payment_plan.installment_added",
    entityType: "installment",
    entityId: result.data.id,
    after: {
      enrollmentId,
      planId,
      amount: parsed.data.amount,
      dueDate: parsed.data.dueDate,
    },
  });

  revalidatePath(`/admin/enrollments/${enrollmentId}`);
  return { success: true };
}

export async function editInstallmentAction(
  installmentId: string,
  enrollmentId: string,
  _prevState: PaymentPlanFormState,
  formData: FormData,
): Promise<PaymentPlanFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = parseInstallmentLineFormData(formData);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Invalid installment." };
  }

  const result = await editInstallment(installmentId, parsed.data);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "payment_plan.installment_edited",
    entityType: "installment",
    entityId: installmentId,
    after: { enrollmentId, amount: parsed.data.amount, dueDate: parsed.data.dueDate },
  });

  revalidatePath(`/admin/enrollments/${enrollmentId}`);
  return { success: true };
}

export async function waiveInstallmentAction(
  installmentId: string,
  enrollmentId: string,
  _prevState: PaymentPlanFormState,
  _formData: FormData,
): Promise<PaymentPlanFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const result = await waiveInstallment(installmentId);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "payment_plan.installment_waived",
    entityType: "installment",
    entityId: installmentId,
    after: { enrollmentId, status: "waived" },
  });

  revalidatePath(`/admin/enrollments/${enrollmentId}`);
  return { success: true };
}

export async function removeInstallmentAction(
  installmentId: string,
  enrollmentId: string,
  _prevState: PaymentPlanFormState,
  _formData: FormData,
): Promise<PaymentPlanFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const result = await removeInstallment(installmentId);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "payment_plan.installment_removed",
    entityType: "installment",
    entityId: installmentId,
    after: { enrollmentId },
  });

  revalidatePath(`/admin/enrollments/${enrollmentId}`);
  return { success: true };
}
