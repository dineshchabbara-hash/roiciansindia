import { z } from "zod";
import {
  BATCH_STATUSES,
  DELIVERY_MODES,
  isDeliveryMode,
  isValidDateRange,
  parseDaysOfWeekInput,
  type DeliveryMode,
} from "@/lib/domain/batches";

// Same "blank means not provided" convention as
// lib/validation/students.ts / lib/validation/trainers.ts / lib/validation/programs.ts.
const optionalTrimmed = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_ERROR = "Enter a valid date (YYYY-MM-DD).";
const TIME_ERROR = "Enter a valid time (HH:MM).";
const DATE_RANGE_ERROR = "End date cannot be before the start date.";
const CAPACITY_ERROR = "Enter a whole number of 1 or more.";
const DEFAULT_TIMEZONE = "Asia/Kolkata";

const checkboxField = z
  .union([z.literal("on"), z.literal("true"), z.undefined(), z.null()])
  .optional()
  .transform((v) => v === "on" || v === "true");

export const batchProfileSchema = z
  .object({
    programId: z.string().trim().uuid("Select a valid program"),
    name: z.string().trim().min(1, "Batch name is required"),
    startDate: z.string().trim().min(1, "Start date is required"),
    expectedEndDate: optionalTrimmed,
    daysOfWeek: optionalTrimmed,
    startTime: optionalTrimmed,
    endTime: optionalTrimmed,
    timezone: optionalTrimmed,
    deliveryMode: optionalTrimmed,
    capacity: optionalTrimmed,
    meetingLink: optionalTrimmed,
    location: optionalTrimmed,
    notes: optionalTrimmed,
  })
  .transform((data, ctx) => {
    if (!DATE_PATTERN.test(data.startDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: DATE_ERROR,
        path: ["startDate"],
      });
      return z.NEVER;
    }

    let expectedEndDate: string | null = null;
    if (data.expectedEndDate) {
      if (!DATE_PATTERN.test(data.expectedEndDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: DATE_ERROR,
          path: ["expectedEndDate"],
        });
        return z.NEVER;
      }
      expectedEndDate = data.expectedEndDate;
    }

    if (!isValidDateRange(data.startDate, expectedEndDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: DATE_RANGE_ERROR,
        path: ["expectedEndDate"],
      });
      return z.NEVER;
    }

    for (const [field, value] of [
      ["startTime", data.startTime],
      ["endTime", data.endTime],
    ] as const) {
      if (value && !TIME_PATTERN.test(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: TIME_ERROR, path: [field] });
        return z.NEVER;
      }
    }

    let capacity: number | null = null;
    if (data.capacity) {
      if (!/^\d+$/.test(data.capacity) || Number(data.capacity) < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: CAPACITY_ERROR,
          path: ["capacity"],
        });
        return z.NEVER;
      }
      capacity = Number(data.capacity);
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
      programId: data.programId,
      name: data.name,
      startDate: data.startDate,
      expectedEndDate,
      daysOfWeek: data.daysOfWeek ? parseDaysOfWeekInput(data.daysOfWeek) : [],
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      timezone: data.timezone ?? DEFAULT_TIMEZONE,
      deliveryMode,
      capacity,
      meetingLink: data.meetingLink ?? null,
      location: data.location ?? null,
      notes: data.notes ?? null,
    };
  });

export type BatchProfileInput = z.infer<typeof batchProfileSchema>;

export const batchStatusSchema = z.object({
  status: z.enum(BATCH_STATUSES),
});

export const trainerAssignmentSchema = z.object({
  trainerId: z.string().trim().uuid("Select a valid trainer"),
  isPrimary: checkboxField,
});
