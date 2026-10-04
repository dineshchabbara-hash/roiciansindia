import { z } from "zod";

// Same money/date conventions as lib/validation/enrollments.ts.
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const MONEY_ERROR = "Enter a non-negative amount with at most 2 decimal places.";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_ERROR = "Enter a valid date (YYYY-MM-DD).";

const optionalTrimmed = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const installmentLineSchema = z.object({
  label: optionalTrimmed,
  amount: z.string().trim().regex(MONEY_PATTERN, MONEY_ERROR),
  dueDate: z.string().trim().regex(DATE_PATTERN, DATE_ERROR),
});

export type InstallmentLineInput = z.infer<typeof installmentLineSchema>;

// Creates the plan itself — payment_plans.total_amount is never submitted;
// it is always computed server-side as sum(installments.amount)
// (lib/domain/payment-plans.ts's own header comment).
export const createPaymentPlanSchema = z.object({
  installments: z
    .array(installmentLineSchema)
    .min(1, "Add at least one installment line."),
});

export type CreatePaymentPlanInput = z.infer<typeof createPaymentPlanSchema>;

// One new installment appended to an existing plan — its own small,
// independently-submittable form (matches this codebase's established
// one-control-per-form style, e.g. EnrollmentStatusControl).
export const addInstallmentSchema = installmentLineSchema;
export type AddInstallmentInput = z.infer<typeof addInstallmentSchema>;

// Editing one EXISTING installment's own fields — also its own small form,
// keyed by the installment's real id (never trusted on its own; the data
// layer re-scopes every edit to the exact plan the id actually belongs to).
export const editInstallmentSchema = installmentLineSchema;
export type EditInstallmentInput = z.infer<typeof editInstallmentSchema>;

/**
 * Parses the "create plan" form's FormData: parallel repeated-name fields
 * (label/amount/dueDate, one triple per row, in submission order) for
 * installments that don't have an id yet — there is nothing to key them by,
 * so position in submission order IS the ordering (becomes `sequence`
 * 1..N server-side).
 */
export function parseCreatePaymentPlanFormData(formData: FormData) {
  const labels = formData.getAll("label");
  const amounts = formData.getAll("amount");
  const dueDates = formData.getAll("dueDate");

  const installments = amounts.map((_, i) => ({
    label: typeof labels[i] === "string" ? labels[i] : null,
    amount: typeof amounts[i] === "string" ? amounts[i] : "",
    dueDate: typeof dueDates[i] === "string" ? dueDates[i] : "",
  }));

  return createPaymentPlanSchema.safeParse({ installments });
}

export function parseInstallmentLineFormData(formData: FormData) {
  return installmentLineSchema.safeParse({
    label: formData.get("label"),
    amount: formData.get("amount"),
    dueDate: formData.get("dueDate"),
  });
}
