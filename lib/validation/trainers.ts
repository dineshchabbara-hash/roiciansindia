import { z } from "zod";
import { COUNTRY_ERROR, PHONE_ERROR, phoneCountryField } from "@/lib/validation/students";
import {
  normalizeInternationalPhone,
  parseSpecializationInput,
} from "@/lib/domain/trainers";

// Re-exported so callers only ever need one import path for trainer
// validation, even though the underlying pieces are shared with students.
export { COUNTRY_ERROR, PHONE_ERROR };

const optionalTrimmed = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/**
 * trainers.phone is nullable (unlike students.phone, which is required) —
 * blank is valid and means "no phone on file"; anything non-blank must be a
 * genuinely valid number for the selected country, via the same
 * libphonenumber-js-backed normalizeInternationalPhone() students use.
 */
export const trainerProfileSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required"),
    lastName: z.string().trim().min(1, "Last name is required"),
    email: z
      .string()
      .trim()
      .min(1, "Email is required")
      .email("Enter a valid email address"),
    phoneCountry: phoneCountryField,
    phone: optionalTrimmed,
    bio: optionalTrimmed,
    // Comma-separated free text in the form (e.g. "React, Node.js,
    // Testing") — there is no existing controlled skills vocabulary to
    // select from, so a single text field parsed into trainers.specialization
    // (text[]) is the minimal representation, not a new schema concept.
    specialization: optionalTrimmed,
  })
  .transform((data, ctx) => {
    let normalizedPhone: string | null = null;
    if (data.phone) {
      normalizedPhone = normalizeInternationalPhone(data.phone, data.phoneCountry);
      if (!normalizedPhone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: PHONE_ERROR,
          path: ["phone"],
        });
        return z.NEVER;
      }
    }
    return {
      ...data,
      phone: normalizedPhone,
      specialization: data.specialization
        ? parseSpecializationInput(data.specialization)
        : [],
    };
  });

export type TrainerProfileInput = z.infer<typeof trainerProfileSchema>;

export const trainerStatusSchema = z.object({
  status: z.enum(["active", "inactive"]),
});

// Trainer duplicate-override uses the exact same shape as students' — no
// trainer-specific fields needed, so this re-exports rather than
// duplicating lib/validation/students.ts's duplicateOverrideSchema.
export { duplicateOverrideSchema } from "@/lib/validation/students";
