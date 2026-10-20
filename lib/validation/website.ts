import { z } from "zod";
import {
  REGISTRATION_STATES,
  SECTION_TYPES_BY_KIND,
  WEBSITE_LIMITS,
  containsMarkup,
  containsPrice,
  isSafeWebsiteHref,
  isValidSectionKey,
  isValidWebsiteSlug,
} from "@/lib/domain/website";
import type { WebsiteDocumentKind } from "@/lib/supabase/database.types";

/**
 * Phase 22A website-content validation. Mirrors website_validate_sections()
 * and the column limits in 20260101000040_website_content_foundation.sql so a
 * form (Phase 22B) can explain a problem before calling the database, which
 * re-validates everything. Structured fields only: there is no HTML, script,
 * fee or price field, and unknown keys are rejected (strict objects).
 */

const plainText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .refine((v) => !containsMarkup(v), `${label} must be plain text (no HTML tags).`)
    .refine(
      (v) => !containsPrice(v),
      `${label} must not show prices — the public website has no pricing.`,
    );

const requiredText = (max: number, label: string) =>
  plainText(max, label).refine((v) => v.length > 0, `${label} is required.`);

const optionalText = (max: number, label: string) =>
  plainText(max, label)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const safeHref = z
  .string()
  .refine(
    isSafeWebsiteHref,
    "Links must be a site path (/…), an https:// URL, mailto: or tel:.",
  );

const uuid = z.string().uuid("Choose a valid item.");

export const websiteSectionItemSchema = z
  .strictObject({
    title: plainText(WEBSITE_LIMITS.itemTitle, "Item title").optional(),
    text: plainText(WEBSITE_LIMITS.itemText, "Item text").optional(),
    question: plainText(WEBSITE_LIMITS.itemTitle, "Question").optional(),
    answer: plainText(WEBSITE_LIMITS.itemText, "Answer").optional(),
    label: plainText(WEBSITE_LIMITS.itemLabel, "Label").optional(),
    href: safeHref.optional(),
  })
  .refine(
    (item) => Object.values(item).some((v) => v !== undefined && v !== ""),
    "An item cannot be empty.",
  );

export const websiteSectionSchema = z.strictObject({
  key: z
    .string()
    .refine(
      isValidSectionKey,
      "Section keys use lowercase letters, digits and hyphens (max 40).",
    ),
  type: z.string(),
  visible: z.boolean().default(true),
  heading: plainText(WEBSITE_LIMITS.sectionHeading, "Heading").optional(),
  body: plainText(WEBSITE_LIMITS.sectionBody, "Text").optional(),
  imageAssetId: uuid.optional(),
  cta: z
    .strictObject({
      label: requiredText(WEBSITE_LIMITS.ctaLabel, "Button label"),
      href: safeHref,
    })
    .optional(),
  items: z
    .array(websiteSectionItemSchema)
    .max(WEBSITE_LIMITS.items, `At most ${WEBSITE_LIMITS.items} items.`)
    .optional(),
});

export type WebsiteSection = z.infer<typeof websiteSectionSchema>;

/** Sections for one document kind: allowed types only, unique keys. */
export function websiteSectionsSchema(kind: WebsiteDocumentKind) {
  const allowed = SECTION_TYPES_BY_KIND[kind] as readonly string[];
  return z
    .array(websiteSectionSchema)
    .max(WEBSITE_LIMITS.sections, `At most ${WEBSITE_LIMITS.sections} sections.`)
    .superRefine((sections, ctx) => {
      const seen = new Set<string>();
      sections.forEach((s, i) => {
        if (!allowed.includes(s.type)) {
          ctx.addIssue({
            code: "custom",
            path: [i, "type"],
            message: `"${s.type}" sections are not supported on this page.`,
          });
        }
        if (seen.has(s.key)) {
          ctx.addIssue({
            code: "custom",
            path: [i, "key"],
            message: `Section key "${s.key}" is used twice.`,
          });
        }
        seen.add(s.key);
      });
    });
}

export function websiteDraftSchema(kind: WebsiteDocumentKind) {
  return z.object({
    baseRevisionNumber: z.number().int().min(0),
    title: requiredText(WEBSITE_LIMITS.title, kind === "program" ? "Headline" : "Title"),
    summary: optionalText(WEBSITE_LIMITS.summary, "Summary"),
    seoTitle: optionalText(WEBSITE_LIMITS.seoTitle, "SEO title"),
    seoDescription: optionalText(WEBSITE_LIMITS.seoDescription, "SEO description"),
    socialTitle: optionalText(WEBSITE_LIMITS.socialTitle, "Social title"),
    socialDescription: optionalText(
      WEBSITE_LIMITS.socialDescription,
      "Social description",
    ),
    heroImageAssetId: uuid.nullable().default(null),
    socialImageAssetId: uuid.nullable().default(null),
    sections: websiteSectionsSchema(kind),
  });
}

export const websiteSlugSchema = z
  .string()
  .trim()
  .refine(
    isValidWebsiteSlug,
    "Slugs are 3–100 lowercase letters, digits and single hyphens.",
  );

export const displayGroupSchema = z.object({
  name: requiredText(WEBSITE_LIMITS.groupName, "Group name"),
  description: optionalText(WEBSITE_LIMITS.groupDescription, "Description"),
  isVisible: z.boolean(),
});

export const batchPublicationSchema = z.object({
  publicLabel: optionalText(WEBSITE_LIMITS.batchLabel, "Public label"),
  registrationState: z.enum(REGISTRATION_STATES as [string, ...string[]], {
    message: "Choose Open, Closed or Full.",
  }),
});

/** §7.4 step 5: reason plus typed Program code (the database rechecks both). */
export const programDeletionRequestSchema = z.object({
  programId: uuid,
  confirmationCode: z.string().min(1, "Type the Program code to confirm."),
  reason: z
    .string()
    .trim()
    .min(1, "Enter the reason for deletion.")
    .max(
      WEBSITE_LIMITS.deletionReason,
      `The reason must be at most ${WEBSITE_LIMITS.deletionReason} characters.`,
    ),
});

/** Exact, case-sensitive match against the Program code. */
export function deletionConfirmationMatches(typed: string, programCode: string): boolean {
  return typed === programCode;
}
