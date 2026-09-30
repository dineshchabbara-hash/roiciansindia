import { z } from "zod";
import { isSupportedCountry } from "libphonenumber-js";
import {
  DEFAULT_PHONE_COUNTRY,
  normalizeInternationalPhone,
} from "@/lib/domain/students";

const PHONE_ERROR = "Enter a valid phone number for the selected country.";
const COUNTRY_ERROR = "Select a valid country.";

// Same "blank means not provided" convention as lib/validation/students.ts.
const optionalTrimmed = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

// Same country-aware phone field as lib/validation/students.ts's
// phoneCountryField — duplicated rather than imported because that module
// does not export it, and this schema is intentionally a separate,
// narrower one (see below), not a variant of the admin schema.
const phoneCountryField = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value, ctx) => {
    if (value === null || value === undefined || value === "") {
      return DEFAULT_PHONE_COUNTRY;
    }
    if (!isSupportedCountry(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: COUNTRY_ERROR });
      return z.NEVER;
    }
    return value;
  });

/**
 * Student self-service profile edit — deliberately limited to exactly the
 * fields REQUIREMENTS.md FR-41 authorizes a Student to change themselves
 * (phone, address, profile photo, password). Name, date of birth, gender,
 * email, emergency contact, status, and every other identity/enrollment-
 * critical field require an Admin. This is a distinct, narrower schema from
 * lib/validation/students.ts's admin-facing studentProfileSchema, not a
 * client-side subset of it: the database independently enforces the same
 * boundary via the prevent_student_self_edit_of_protected_fields trigger
 * (supabase/migrations/20260101000014_rls_policies.sql), so a bug here
 * could never widen what a Student can actually change — this schema exists
 * only to give a Student a clear, specific error instead of a raw database
 * exception.
 *
 * Profile photo upload and password change are intentionally NOT part of
 * this schema for Phase 10 — see the Phase 10 report for why (a Storage
 * bucket + RLS for photo upload, and Supabase Auth's own password-update
 * flow, are both separate units of work not built in this phase).
 */
export const studentSelfProfileSchema = z
  .object({
    phoneCountry: phoneCountryField,
    phone: z.string().trim().min(1, "Phone is required"),
    alternatePhone: optionalTrimmed,
    addressLine1: optionalTrimmed,
    addressLine2: optionalTrimmed,
    city: optionalTrimmed,
    state: optionalTrimmed,
    postalCode: optionalTrimmed,
  })
  .transform((data, ctx) => {
    const normalizedPhone = normalizeInternationalPhone(data.phone, data.phoneCountry);
    if (!normalizedPhone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: PHONE_ERROR,
        path: ["phone"],
      });
      return z.NEVER;
    }
    return { ...data, phone: normalizedPhone };
  });

export type StudentSelfProfileInput = z.infer<typeof studentSelfProfileSchema>;
