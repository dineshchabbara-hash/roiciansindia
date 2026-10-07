import { z } from "zod";

// Same conventions already established across lib/validation/*.ts —
// empty-string-as-null for optional text (lib/validation/payment-plans.ts's
// optionalTrimmed).

const optionalTrimmed = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/**
 * completion_date is NOT NULL with no DB default (unlike issue_date, which
 * defaults to current_date) — Admin must state when the enrollment was
 * actually completed, which is not necessarily "today".
 */
export const issueCertificateSchema = z.object({
  completionDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid completion date."),
});

export type IssueCertificateInput = z.infer<typeof issueCertificateSchema>;

export function parseIssueCertificateFormData(formData: FormData) {
  return issueCertificateSchema.safeParse({
    completionDate: formData.get("completionDate"),
  });
}

export const revokeCertificateSchema = z.object({
  revokedReason: optionalTrimmed,
});

export type RevokeCertificateInput = z.infer<typeof revokeCertificateSchema>;

export function parseRevokeCertificateFormData(formData: FormData) {
  return revokeCertificateSchema.safeParse({
    revokedReason: formData.get("revokedReason"),
  });
}

/**
 * Reissue takes an optional note only — completion_date is carried over
 * from the certificate being replaced (the underlying academic completion
 * event hasn't changed, only the certificate record), and issue_date for
 * the new row is always today, server-set, never a form field.
 */
export const reissueCertificateSchema = z.object({
  reason: optionalTrimmed,
});

export type ReissueCertificateInput = z.infer<typeof reissueCertificateSchema>;

export function parseReissueCertificateFormData(formData: FormData) {
  return reissueCertificateSchema.safeParse({
    reason: formData.get("reason"),
  });
}
