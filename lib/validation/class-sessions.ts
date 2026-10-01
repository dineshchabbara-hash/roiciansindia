import { z } from "zod";
import { CLASS_SESSION_STATUSES, isValidTimeRange } from "@/lib/domain/class-sessions";

// Same "blank means not provided" convention as
// lib/validation/batches.ts / lib/validation/students.ts / etc.
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
const TIME_RANGE_ERROR = "End time cannot be before the start time.";

// batchId/sessionId are never part of this schema — both routes that use it
// (/admin/batches/[id]/sessions/..., /trainer/batches/[id]/sessions/...)
// bind the batch id server-side from the route's own already-authorized
// params, exactly like lib/validation/batches.ts's trainerAssignmentSchema
// (batchId bound, never read from form input) — never trusting a batch id
// the browser could submit in a hidden field.
export const classSessionInputSchema = z
  .object({
    sessionDate: z.string().trim().min(1, "Session date is required"),
    startTime: optionalTrimmed,
    endTime: optionalTrimmed,
    topic: optionalTrimmed,
    description: optionalTrimmed,
    meetingLink: optionalTrimmed,
    notes: optionalTrimmed,
  })
  .transform((data, ctx) => {
    if (!DATE_PATTERN.test(data.sessionDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: DATE_ERROR,
        path: ["sessionDate"],
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

    if (!isValidTimeRange(data.startTime ?? null, data.endTime ?? null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: TIME_RANGE_ERROR,
        path: ["endTime"],
      });
      return z.NEVER;
    }

    return {
      sessionDate: data.sessionDate,
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      topic: data.topic ?? null,
      description: data.description ?? null,
      meetingLink: data.meetingLink ?? null,
      notes: data.notes ?? null,
    };
  });

export type ClassSessionInput = z.infer<typeof classSessionInputSchema>;

export const classSessionStatusSchema = z.object({
  status: z.enum(CLASS_SESSION_STATUSES),
});
