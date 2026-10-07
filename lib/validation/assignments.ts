import { z } from "zod";

// Same money/date/uuid conventions already established across
// lib/validation/*.ts — z.string().uuid() for a real foreign-key id,
// empty-string-as-null for optional text (lib/validation/payment-plans.ts's
// optionalTrimmed, lib/validation/materials.ts's own optionalUuid).

const optionalTrimmed = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalUuid = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .refine(
    (v) => v === null || v === undefined || z.string().uuid().safeParse(v).success,
    { message: "Invalid id." },
  );

/**
 * Shape-level validation only. programId/batchId/trainerId are never part
 * of this form's own fields — the Admin/Trainer action binds them from the
 * page context (batch id in the URL, trainer resolved server-side or
 * chosen from the batch's own assigned trainers), the same discipline
 * lib/actions/materials.ts already uses for scope ids. moduleId is the one
 * optional scope-adjacent field a form may submit directly, mirroring
 * materials' own Program-page Module picker, re-verified server-side
 * against the bound batch's own program (see lib/actions/assignments.ts).
 */
export const createAssignmentSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
  description: optionalTrimmed,
  moduleId: optionalUuid,
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid due date."),
  maxMarks: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .refine(
      (v) =>
        v === null || v === undefined || (!Number.isNaN(Number(v)) && Number(v) >= 0),
      { message: "Max marks must be a non-negative number." },
    ),
});

export type CreateAssignmentInput = {
  title: string;
  description: string | null;
  moduleId: string | null;
  dueDate: string;
  maxMarks: number | null;
};

export function parseCreateAssignmentFormData(
  formData: FormData,
):
  { success: true; data: CreateAssignmentInput } | { success: false; error: z.ZodError } {
  const result = createAssignmentSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    moduleId: formData.get("moduleId"),
    dueDate: formData.get("dueDate"),
    maxMarks: formData.get("maxMarks"),
  });
  if (!result.success) return { success: false, error: result.error };
  return {
    success: true,
    data: {
      title: result.data.title,
      description: result.data.description ?? null,
      moduleId: result.data.moduleId ?? null,
      dueDate: result.data.dueDate,
      maxMarks:
        result.data.maxMarks === null || result.data.maxMarks === undefined
          ? null
          : Number(result.data.maxMarks),
    },
  };
}

/**
 * A submission needs at least a text response or a file (the table's own
 * CHECK constraint has no such rule — assignment_submissions has no
 * materials_file_or_link-style constraint at all, both text_response and
 * file_path are independently nullable — but an entirely empty submission
 * has no product meaning, so this is an application-layer minimum, not a
 * DB rule).
 */
export const submitAssignmentSchema = z
  .object({
    textResponse: optionalTrimmed,
  })
  .transform((data) => ({ textResponse: data.textResponse ?? null }));

export type SubmitAssignmentInput = z.infer<typeof submitAssignmentSchema>;

/**
 * Review input — FR-45/FR-53's only authorized fields (marks, feedback).
 * nextStatus is restricted to the two schema values that make sense as a
 * reviewer's own outcome (`reviewed` / `resubmission_requested`) — never
 * `not_submitted`/`submitted`/`late`, which are the submission's own
 * pre-review states, not something a reviewer sets directly.
 */
export const reviewSubmissionSchema = z.object({
  marks: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .refine(
      (v) =>
        v === null || v === undefined || (!Number.isNaN(Number(v)) && Number(v) >= 0),
      { message: "Marks must be a non-negative number." },
    ),
  trainerFeedback: optionalTrimmed,
  nextStatus: z.enum(["reviewed", "resubmission_requested"], {
    message: "Invalid review outcome.",
  }),
});

export type ReviewSubmissionInput = {
  marks: number | null;
  trainerFeedback: string | null;
  nextStatus: "reviewed" | "resubmission_requested";
};

export function parseReviewSubmissionFormData(
  formData: FormData,
):
  { success: true; data: ReviewSubmissionInput } | { success: false; error: z.ZodError } {
  const result = reviewSubmissionSchema.safeParse({
    marks: formData.get("marks"),
    trainerFeedback: formData.get("trainerFeedback"),
    nextStatus: formData.get("nextStatus"),
  });
  if (!result.success) return { success: false, error: result.error };
  return {
    success: true,
    data: {
      marks:
        result.data.marks === null || result.data.marks === undefined
          ? null
          : Number(result.data.marks),
      trainerFeedback: result.data.trainerFeedback ?? null,
      nextStatus: result.data.nextStatus,
    },
  };
}
