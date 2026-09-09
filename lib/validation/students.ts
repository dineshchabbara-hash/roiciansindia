import { z } from "zod";
import { normalizeIndianPhone } from "@/lib/domain/students";

/**
 * Shared between client-side form feedback and server-side enforcement in
 * the corresponding Server Action (see lib/validation/auth.ts for the same
 * pattern) — the server-side run is mandatory (SECURITY_PLAN.md §4).
 */

// Optional-but-not-empty-string: an empty form field should mean "not
// provided" (null), not an empty string reaching the database.
const optionalTrimmed = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalEmail = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .refine(
    (v) => v === null || v === undefined || z.string().email().safeParse(v).success,
    {
      message: "Enter a valid email address",
    },
  );

const PHONE_ERROR =
  "Enter a valid 10-digit Indian phone number (e.g. 9876543210 or +91 98765 43210).";

// The one shared validator for a required Indian phone field — normalizes to
// canonical +91XXXXXXXXXX on success, rejects (with a visible field error,
// never a silent fallback) anything normalizeIndianPhone() can't resolve.
const indianPhone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizeIndianPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_ERROR });
      return z.NEVER;
    }
    return normalized;
  });

export const studentProfileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  preferredName: optionalTrimmed,
  email: optionalEmail,
  phone: indianPhone,
  alternatePhone: optionalTrimmed,
  dateOfBirth: optionalTrimmed,
  gender: optionalTrimmed,
  addressLine1: optionalTrimmed,
  addressLine2: optionalTrimmed,
  city: optionalTrimmed,
  state: optionalTrimmed,
  postalCode: optionalTrimmed,
  emergencyContactName: optionalTrimmed,
  emergencyContactPhone: optionalTrimmed,
});

export type StudentProfileInput = z.infer<typeof studentProfileSchema>;

export const studentStatusSchema = z.object({
  status: z.enum(["active", "inactive", "archived"]),
});

export const studentNoteSchema = z.object({
  note: z.string().trim().min(1, "Note cannot be empty").max(2000, "Note is too long"),
});

export const duplicateOverrideSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Please explain why this is not a duplicate")
    .max(500, "Reason is too long"),
});
