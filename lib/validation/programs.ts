import { z } from "zod";
import {
  DELIVERY_MODES,
  DURATION_UNITS,
  isDeliveryMode,
  isDurationUnit,
  PROGRAM_STATUSES,
  type DeliveryMode,
  type DurationUnit,
} from "@/lib/domain/programs";

// Same "blank means not provided" convention as
// lib/validation/students.ts / lib/validation/trainers.ts.
const optionalTrimmed = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

// programs.regular_fee/registration_fee are `numeric(12, 2) not null`.
// Validated and passed through as plain decimal strings — never parsed to a
// JS float — so the exact admin-entered value reaches Postgres unchanged
// (see lib/domain/money.ts's header comment on why this project never lets
// a monetary value round-trip through floating point).
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const MONEY_ERROR = "Enter a non-negative amount with at most 2 decimal places.";

// programs.tax_rate_percent is `numeric(5, 2)`, nullable ("use the company
// default"). Bounded to 0-100 here as a sane percentage — the column itself
// allows up to 999.99, but nothing in this codebase's tax model treats a
// rate above 100% as meaningful.
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;
const PERCENT_ERROR = "Enter a percentage between 0 and 100, with at most 2 decimals.";

const DURATION_VALUE_ERROR = "Enter a whole number of 1 or more.";

const checkboxField = z
  .union([z.literal("on"), z.literal("true"), z.undefined(), z.null()])
  .optional()
  .transform((v) => v === "on" || v === "true");

export const programProfileSchema = z
  .object({
    programCode: z
      .string()
      .trim()
      .min(1, "Program code is required")
      .max(50, "Program code must be 50 characters or fewer"),
    name: z.string().trim().min(1, "Program name is required"),
    description: optionalTrimmed,
    category: optionalTrimmed,
    durationValue: optionalTrimmed,
    durationUnit: optionalTrimmed,
    deliveryMode: optionalTrimmed,
    regularFee: z.string().trim().min(1, "Regular fee is required"),
    registrationFee: optionalTrimmed,
    taxRatePercent: optionalTrimmed,
    certificateEligible: checkboxField,
    installmentsAllowed: checkboxField,
  })
  .transform((data, ctx) => {
    if (!MONEY_PATTERN.test(data.regularFee)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: MONEY_ERROR,
        path: ["regularFee"],
      });
      return z.NEVER;
    }

    let registrationFee = "0";
    if (data.registrationFee) {
      if (!MONEY_PATTERN.test(data.registrationFee)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: MONEY_ERROR,
          path: ["registrationFee"],
        });
        return z.NEVER;
      }
      registrationFee = data.registrationFee;
    }

    let taxRatePercent: string | null = null;
    if (data.taxRatePercent) {
      if (
        !PERCENT_PATTERN.test(data.taxRatePercent) ||
        Number(data.taxRatePercent) > 100
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: PERCENT_ERROR,
          path: ["taxRatePercent"],
        });
        return z.NEVER;
      }
      taxRatePercent = data.taxRatePercent;
    }

    let durationValue: number | null = null;
    if (data.durationValue) {
      if (!/^\d+$/.test(data.durationValue) || Number(data.durationValue) < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: DURATION_VALUE_ERROR,
          path: ["durationValue"],
        });
        return z.NEVER;
      }
      durationValue = Number(data.durationValue);
    }

    let durationUnit: DurationUnit | null = null;
    if (data.durationUnit) {
      if (!isDurationUnit(data.durationUnit)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Select one of: ${DURATION_UNITS.join(", ")}.`,
          path: ["durationUnit"],
        });
        return z.NEVER;
      }
      durationUnit = data.durationUnit;
    }

    let deliveryMode: DeliveryMode | null = null;
    if (data.deliveryMode) {
      if (!isDeliveryMode(data.deliveryMode)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Select one of: ${DELIVERY_MODES.join(", ")}.`,
          path: ["deliveryMode"],
        });
        return z.NEVER;
      }
      deliveryMode = data.deliveryMode;
    }

    return {
      programCode: data.programCode,
      name: data.name,
      description: data.description ?? null,
      category: data.category ?? null,
      durationValue,
      durationUnit,
      deliveryMode,
      regularFee: data.regularFee,
      registrationFee,
      taxRatePercent,
      certificateEligible: data.certificateEligible,
      installmentsAllowed: data.installmentsAllowed,
    };
  });

export type ProgramProfileInput = z.infer<typeof programProfileSchema>;

export const programStatusSchema = z.object({
  status: z.enum(PROGRAM_STATUSES),
});
