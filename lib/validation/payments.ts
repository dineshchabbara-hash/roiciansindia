import { z } from "zod";
import {
  OFFLINE_PAYMENT_METHODS,
  OFFLINE_PAYMENT_TYPES,
  RUPEE_AMOUNT_PATTERN,
  isAllowedPaymentDate,
  rupeeStringToPaise,
} from "@/lib/domain/payments";

/**
 * Phase 20A offline payment form (SECURITY_PLAN.md §4 names this schema
 * `recordOfflinePaymentSchema`). Mirrors record_offline_payment()'s own
 * checks so a bad value is explained before the round trip; the database
 * re-validates everything and stays the authority (overpayment and
 * enrollment eligibility are only decided there, under a row lock).
 *
 * Never submitted, by design: the student (derived from the enrollment),
 * the recording admin (derived from the session), the status (always
 * `paid`), the tax amount (0 — the enrollment's total_payable already
 * carries its tax) and the payment code (DB-generated).
 */

const UUID_MESSAGE = "This form is out of date. Reload the page and try again.";

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const recordOfflinePaymentSchema = z.object({
  paymentId: z.string().uuid(UUID_MESSAGE),
  enrollmentId: z.string().uuid(UUID_MESSAGE),
  amount: z
    .string()
    .trim()
    .regex(
      RUPEE_AMOUNT_PATTERN,
      "Enter an amount in rupees with at most 2 decimal places.",
    )
    .refine((v) => (rupeeStringToPaise(v) ?? 0) > 0, "Amount must be greater than zero."),
  method: z.enum(OFFLINE_PAYMENT_METHODS, { message: "Choose a payment method." }),
  paymentType: z.enum(OFFLINE_PAYMENT_TYPES, { message: "Choose a payment type." }),
  paidOn: z
    .string()
    .trim()
    .refine(
      (v) => isAllowedPaymentDate(v),
      "Enter the date received (today or earlier).",
    ),
  reference: optionalText(100, "Reference"),
  notes: optionalText(1000, "Notes"),
});

export type RecordOfflinePaymentInput = z.infer<typeof recordOfflinePaymentSchema>;

function field(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

export function parseRecordOfflinePaymentFormData(formData: FormData) {
  return recordOfflinePaymentSchema.safeParse({
    paymentId: field(formData, "paymentId") ?? "",
    enrollmentId: field(formData, "enrollmentId") ?? "",
    amount: field(formData, "amount") ?? "",
    method: field(formData, "method") ?? "",
    paymentType: field(formData, "paymentType") ?? "",
    paidOn: field(formData, "paidOn") ?? "",
    reference: field(formData, "reference"),
    notes: field(formData, "notes"),
  });
}
