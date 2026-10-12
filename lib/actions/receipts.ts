"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import { ensureReceiptForPayment } from "@/lib/data/receipts";

/**
 * Phase 21A — Admin "Generate receipt" recovery action. Receipts are issued
 * automatically when a payment becomes paid; this exists only for the case
 * where that automatic step did not complete (issuance or PDF generation
 * failed, or the payment predates Phase 21A). It is idempotent: an
 * existing receipt is reused with its number, never re-minted, and a
 * non-paid payment is refused by the database. The receipt.issued audit
 * row is written by issue_receipt() itself, once.
 */

const NOT_AUTHORIZED = "You are not authorized to generate receipts.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GenerateReceiptState = {
  error?: string;
  message?: string;
};

export async function generateReceiptAction(
  _prevState: GenerateReceiptState,
  formData: FormData,
): Promise<GenerateReceiptState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) return { error: NOT_AUTHORIZED };

  const paymentId = formData.get("paymentId");
  if (typeof paymentId !== "string" || !UUID_PATTERN.test(paymentId)) {
    return { error: "Invalid payment." };
  }

  const result = await ensureReceiptForPayment(paymentId);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/admin/payments/${paymentId}`);
  if (!result.data.pdfReady) {
    return {
      error: `Receipt ${result.data.receiptNumber} is issued but its PDF could not be generated. Please try again.`,
    };
  }
  return {
    message: result.data.alreadyIssued
      ? `Receipt ${result.data.receiptNumber} is ready.`
      : `Receipt ${result.data.receiptNumber} generated.`,
  };
}
