import { z } from "zod";

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

export const studentProfileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  preferredName: optionalTrimmed,
  email: optionalEmail,
  phone: z
    .string()
    .trim()
    .min(6, "Enter a valid phone number")
    .max(20, "Enter a valid phone number"),
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
