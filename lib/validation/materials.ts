import { z } from "zod";
import { MATERIAL_TYPES } from "@/lib/domain/materials";

// Same money/date/uuid conventions already established across
// lib/validation/*.ts — z.string().uuid() for a real foreign-key id
// (lib/validation/attendance.ts's own enrollmentId), empty-string-as-null
// for optional text (lib/validation/payment-plans.ts's optionalTrimmed).

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
    {
      message: "Invalid id.",
    },
  );

/**
 * Shape-level validation only — the "exactly one scope" business rule
 * (Phase 15's approved interpretation, not the DB CHECK) is enforced by
 * lib/domain/materials.ts's own resolveExactlyOneScope, not duplicated
 * here, so there is exactly one place that rule lives. The
 * materials_file_or_link DB CHECK (external_url required for link/video,
 * file_path required for file) IS mirrored here, since it is already an
 * existing schema-level rule, not an invented one.
 */
export const createMaterialSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required."),
    description: optionalTrimmed,
    materialType: z.enum(MATERIAL_TYPES, { message: "Invalid material type." }),
    externalUrl: optionalTrimmed,
    programId: optionalUuid,
    batchId: optionalUuid,
    moduleId: optionalUuid,
    classSessionId: optionalUuid,
  })
  .superRefine((data, ctx) => {
    if (
      (data.materialType === "link" || data.materialType === "video") &&
      !data.externalUrl
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["externalUrl"],
        message: "A URL is required for a link or video material.",
      });
    }
    if (data.externalUrl) {
      const result = z.string().url().safeParse(data.externalUrl);
      if (!result.success) {
        ctx.addIssue({
          code: "custom",
          path: ["externalUrl"],
          message: "Enter a valid URL.",
        });
      }
    }
  });

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;

export function parseCreateMaterialFormData(formData: FormData) {
  return createMaterialSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    materialType: formData.get("materialType"),
    externalUrl: formData.get("externalUrl"),
    programId: formData.get("programId"),
    batchId: formData.get("batchId"),
    moduleId: formData.get("moduleId"),
    classSessionId: formData.get("classSessionId"),
  });
}
