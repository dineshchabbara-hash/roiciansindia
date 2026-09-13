import { z } from "zod";
import {
  ENROLLMENT_STATUSES,
  PAYMENT_PLAN_TYPES,
  isPaymentPlanType,
} from "@/lib/domain/enrollments";

// Same "blank means not provided" convention as
// lib/validation/students.ts / lib/validation/trainers.ts / lib/validation/programs.ts
// / lib/validation/batches.ts.
const optionalTrimmed = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

// Same money-as-decimal-string convention as lib/validation/programs.ts —
// the exact admin-entered value reaches Postgres unchanged, never
// round-tripped through a JS float (see lib/domain/money.ts).
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const MONEY_ERROR = "Enter a non-negative amount with at most 2 decimal places.";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_ERROR = "Enter a valid date (YYYY-MM-DD).";

export const enrollmentCreateSchema = z
  .object({
    studentId: z.string().trim().uuid("Select a valid student"),
    programId: z.string().trim().uuid("Select a valid program"),
    batchId: optionalTrimmed,
    enrollmentDate: optionalTrimmed,
    regularFee: z.string().trim().min(1, "Regular fee is required"),
    agreedFee: z.string().trim().min(1, "Agreed fee is required"),
    discountAmount: optionalTrimmed,
    discountReason: optionalTrimmed,
    registrationFee: optionalTrimmed,
    taxAmount: optionalTrimmed,
    paymentPlanType: optionalTrimmed,
    source: optionalTrimmed,
    notes: optionalTrimmed,
  })
  .transform((data, ctx) => {
    if (data.batchId && !z.string().uuid().safeParse(data.batchId).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a valid batch",
        path: ["batchId"],
      });
      return z.NEVER;
    }

    let enrollmentDate: string | null = null;
    if (data.enrollmentDate) {
      if (!DATE_PATTERN.test(data.enrollmentDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: DATE_ERROR,
          path: ["enrollmentDate"],
        });
        return z.NEVER;
      }
      enrollmentDate = data.enrollmentDate;
    }

    if (!MONEY_PATTERN.test(data.regularFee)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: MONEY_ERROR,
        path: ["regularFee"],
      });
      return z.NEVER;
    }
    if (!MONEY_PATTERN.test(data.agreedFee)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: MONEY_ERROR,
        path: ["agreedFee"],
      });
      return z.NEVER;
    }

    let discountAmount = "0";
    if (data.discountAmount) {
      if (!MONEY_PATTERN.test(data.discountAmount)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: MONEY_ERROR,
          path: ["discountAmount"],
        });
        return z.NEVER;
      }
      discountAmount = data.discountAmount;
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

    let taxAmount = "0";
    if (data.taxAmount) {
      if (!MONEY_PATTERN.test(data.taxAmount)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: MONEY_ERROR,
          path: ["taxAmount"],
        });
        return z.NEVER;
      }
      taxAmount = data.taxAmount;
    }

    // discount_reason is not currently a required field anywhere in the
    // approved requirements or schema (no CHECK constraint, no documented
    // rule tying it to discount_amount > 0) — see the Phase 9 report. Not
    // enforced here; inventing that rule would be exactly the kind of
    // unapproved business rule this phase must avoid.

    let paymentPlanType: (typeof PAYMENT_PLAN_TYPES)[number] | null = null;
    if (data.paymentPlanType) {
      if (!isPaymentPlanType(data.paymentPlanType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Select one of: ${PAYMENT_PLAN_TYPES.join(", ")}.`,
          path: ["paymentPlanType"],
        });
        return z.NEVER;
      }
      paymentPlanType = data.paymentPlanType;
    }

    return {
      studentId: data.studentId,
      programId: data.programId,
      batchId: data.batchId ?? null,
      enrollmentDate,
      regularFee: data.regularFee,
      agreedFee: data.agreedFee,
      discountAmount,
      discountReason: data.discountReason,
      registrationFee,
      taxAmount,
      paymentPlanType,
      source: data.source,
      notes: data.notes,
    };
  });

export type EnrollmentCreateInput = z.infer<typeof enrollmentCreateSchema>;

export const enrollmentStatusSchema = z.object({
  status: z.enum(ENROLLMENT_STATUSES),
});
