import { z } from "zod";
import { isSupportedCountry } from "libphonenumber-js";
import {
  DEFAULT_PHONE_COUNTRY,
  normalizeInternationalPhone,
} from "@/lib/domain/students";

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

const PHONE_ERROR = "Enter a valid phone number for the selected country.";

// The country selector's value is only ever used as a fallback hint (see
// normalizeInternationalPhone) — an unrecognized value just means "no
// hint", it never itself blocks submission; a genuinely invalid phone
// number is what produces the visible error, on the phone field itself.
const phoneCountryField = z
  .string()
  .trim()
  .transform((v) => (isSupportedCountry(v) ? v : DEFAULT_PHONE_COUNTRY))
  // A missing/malformed selector value (e.g. a hand-crafted form post)
  // falls back to the default rather than blocking the whole submission —
  // the phone field's own validation is what must visibly fail, not this
  // supporting hint.
  .catch(DEFAULT_PHONE_COUNTRY);

export const studentProfileSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required"),
    lastName: z.string().trim().min(1, "Last name is required"),
    preferredName: optionalTrimmed,
    email: optionalEmail,
    phoneCountry: phoneCountryField,
    phone: z.string().trim().min(1, "Phone is required"),
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
  })
  // Object-level transform because normalizing `phone` needs the sibling
  // `phoneCountry` field — this is the one shared validate+normalize step
  // for create, edit, and (via the exported helper) duplicate detection.
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
