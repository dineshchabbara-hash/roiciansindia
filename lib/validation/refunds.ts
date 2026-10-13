import { z } from "zod";
import {
  RUPEE_AMOUNT_PATTERN,
  isAllowedPaymentDate,
  rupeeStringToPaise,
} from "@/lib/domain/payments";

/**
 * Phase 21B refund forms. Mirror record_offline_refund() /
 * reserve_razorpay_refund() so a bad value is explained before the round
 * trip; the database re-validates everything and alone decides the
 * refundable balance (under a payment row lock) and the payment-date rule.
 *
 * Never submitted, by design: the student or enrollment (derived from the
 * payment), the initiating admin (from the session), the status (offline =
 * processed, Razorpay = initiated) and any Razorpay identifier (the stored
 * provider payment id is read server-side).
 */

const UUID_MESSAGE = "This form is out of date. Reload the page and try again.";

const amount = z
  .string()
  .trim()
  .regex(RUPEE_AMOUNT_PATTERN, "Enter an amount in rupees with at most 2 decimal places.")
  .refine(
    (v) => (rupeeStringToPaise(v) ?? 0) > 0,
    "Refund amount must be greater than zero.",
  );

const reason = z
  .string()
  .trim()
  .min(1, "Enter the reason for the refund.")
  .max(500, "Reason must be at most 500 characters.");

const base = {
  refundId: z.string().uuid(UUID_MESSAGE),
  paymentId: z.string().uuid(UUID_MESSAGE),
  amount,
  reason,
};

export const recordOfflineRefundSchema = z.object({
  ...base,
  refundedOn: z
    .string()
    .trim()
    .refine((v) => isAllowedPaymentDate(v), "Enter the refund date (today or earlier)."),
  reference: z
    .string()
    .trim()
    .max(100, "Reference must be at most 100 characters.")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export const initiateRazorpayRefundSchema = z.object(base);

export type RecordOfflineRefundInput = z.infer<typeof recordOfflineRefundSchema>;
export type InitiateRazorpayRefundInput = z.infer<typeof initiateRazorpayRefundSchema>;

function field(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

export function parseRecordOfflineRefundFormData(formData: FormData) {
  return recordOfflineRefundSchema.safeParse({
    refundId: field(formData, "refundId") ?? "",
    paymentId: field(formData, "paymentId") ?? "",
    amount: field(formData, "amount") ?? "",
    reason: field(formData, "reason") ?? "",
    refundedOn: field(formData, "refundedOn") ?? "",
    reference: field(formData, "reference"),
  });
}

export function parseInitiateRazorpayRefundFormData(formData: FormData) {
  return initiateRazorpayRefundSchema.safeParse({
    refundId: field(formData, "refundId") ?? "",
    paymentId: field(formData, "paymentId") ?? "",
    amount: field(formData, "amount") ?? "",
    reason: field(formData, "reason") ?? "",
  });
}
