import type { WebsiteDocumentKind } from "@/lib/supabase/database.types";
import {
  STALE_EDIT_MESSAGE,
  type WebsiteErrorKind,
  type WebsiteSectionType,
} from "@/lib/domain/website";

/**
 * Phase 22B-1: Admin Website Management rules (docs/requirements/PHASE_22B_PLAN.md §4,
 * design §5). Pure data and logic only: no I/O, usable from Server and Client
 * Components, fully unit-testable. The Phase 22A database functions remain the
 * authority. They re-check the session, the stale-edit guard and every content rule.
 */

/** Page types managed in 22B-1. Program pages arrive in 22B-2. */
export type AdminPageKind = Exclude<WebsiteDocumentKind, "program">;

/** Dashboard order: the main pages first, then shared pieces, then legal pages. */
export const ADMIN_PAGE_KINDS: readonly AdminPageKind[] = [
  "home",
  "about",
  "corporate_training",
  "institutions",
  "contact",
  "programs_listing",
  "upcoming_batches",
  "navigation",
  "footer",
  "legal",
];

export const PAGE_KIND_LABELS: Record<AdminPageKind, string> = {
  home: "Home",
  about: "About",
  corporate_training: "Corporate Training",
  institutions: "For Institutions",
  contact: "Contact",
  programs_listing: "Programs listing",
  upcoming_batches: "Upcoming Batches",
  navigation: "Navigation menu",
  footer: "Footer",
  legal: "Legal page",
};

export const PAGE_KIND_DESCRIPTIONS: Record<AdminPageKind, string> = {
  home: "The homepage: hero, introduction, featured Programs and calls to action.",
  about: "Who ROICIANS is and how training is delivered.",
  corporate_training: "Training for companies and teams.",
  institutions: "Partnerships with colleges and institutions.",
  contact: "Contact details and how to reach an advisor.",
  programs_listing:
    "Introduction and FAQs around the Programs list. The Programs themselves come from published Program records.",
  upcoming_batches:
    "Introduction and FAQs around Upcoming Batches. The Batches themselves come from published Batch records.",
  navigation: "The main menu links shown in the website header.",
  footer: "Footer link columns and supporting text.",
  legal: "Privacy, terms and similar pages. Publishing needs approved wording.",
};

/** Fixed page keys for the one-per-website page types. */
export const DEFAULT_PAGE_KEYS: Record<Exclude<AdminPageKind, "legal">, string> = {
  home: "home",
  about: "about",
  corporate_training: "corporate-training",
  institutions: "institutions",
  contact: "contact",
  programs_listing: "programs",
  upcoming_batches: "upcoming-batches",
  navigation: "navigation",
  footer: "footer",
};

export function isAdminPageKind(value: unknown): value is AdminPageKind {
  return (
    typeof value === "string" && (ADMIN_PAGE_KINDS as readonly string[]).includes(value)
  );
}

export function isSingletonPageKind(
  kind: AdminPageKind,
): kind is Exclude<AdminPageKind, "legal"> {
  return kind !== "legal";
}

const PAGE_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Same shape as the database rule (2–100 lowercase letters, digits and single
 * hyphens). A legal page also cannot take a key reserved for another page type
 * or for Program pages.
 */
export function legalPageKeyProblem(key: string): string | null {
  if (key.length < 2 || key.length > 100 || !PAGE_KEY_PATTERN.test(key)) {
    return "Use 2–100 lowercase letters, digits and single hyphens (for example privacy-policy).";
  }
  if ((Object.values(DEFAULT_PAGE_KEYS) as string[]).includes(key)) {
    return "That key is reserved for another page.";
  }
  if (key.startsWith("program-")) {
    return "Keys starting with program- are reserved for Program pages.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Publication status

export type WebsitePageStatus =
  | "not_created"
  | "empty"
  | "draft"
  | "published"
  | "published_with_changes"
  | "unpublished";

export type StatusInput = {
  latestRevisionId: string | null;
  publishedRevisionId: string | null;
  firstPublishedAt: string | null;
} | null;

export function websitePageStatus(doc: StatusInput): WebsitePageStatus {
  if (!doc) return "not_created";
  if (doc.latestRevisionId === null) return "empty";
  if (doc.publishedRevisionId === null) {
    return doc.firstPublishedAt === null ? "draft" : "unpublished";
  }
  return doc.publishedRevisionId === doc.latestRevisionId
    ? "published"
    : "published_with_changes";
}

export const STATUS_LABELS: Record<WebsitePageStatus, string> = {
  not_created: "Not created",
  empty: "Created, nothing saved",
  draft: "Draft",
  published: "Published",
  published_with_changes: "Published, with unpublished changes",
  unpublished: "Unpublished",
};

export const STATUS_BADGE_VARIANTS: Record<
  WebsitePageStatus,
  "outline" | "secondary" | "success" | "warning"
> = {
  not_created: "outline",
  empty: "outline",
  draft: "secondary",
  published: "success",
  published_with_changes: "warning",
  unpublished: "secondary",
};

// ---------------------------------------------------------------------------
// Legal publishing hold (owner decision C4)

/**
 * Legal pages whose wording has the owner's recorded business and legal
 * approval. Empty: nothing is approved yet. Adding a key is a separate,
 * authorized change made after approval of that specific wording.
 *
 * LIMITATION: this hold is enforced by the Admin UI and the server action. The
 * Phase 22A database function website_publish_document() does not know about
 * it, so a signed-in Admin calling the database directly could still publish
 * (that call is audited). A database-level safeguard is proposed separately in
 * docs/proposed-migrations/legal_publication_hold.sql and is NOT applied.
 */
export const APPROVED_LEGAL_PAGE_KEYS: ReadonlySet<string> = new Set<string>();

export function isPublicationHeld(page: {
  kind: AdminPageKind;
  pageKey: string;
}): boolean {
  return page.kind === "legal" && !APPROVED_LEGAL_PAGE_KEYS.has(page.pageKey);
}

export const LEGAL_PUBLICATION_HELD_MESSAGE =
  "Legal pages cannot be published until their wording has business and legal approval. You can keep drafting and previewing this page.";

// ---------------------------------------------------------------------------
// Messages for database outcomes

export const WEBSITE_GENERIC_ERROR = "Something went wrong. Please try again.";

/** Plain-language message for a website database error. */
export function websiteActionMessage(
  kind: WebsiteErrorKind,
  databaseMessage?: string | null,
): string {
  switch (kind) {
    case "not_allowed":
      return "Only an active Admin or Super Admin can manage website content.";
    case "stale":
      return STALE_EDIT_MESSAGE;
    case "not_found":
      return "This page or version no longer exists. Reload the page.";
    case "duplicate":
      return "That page already exists.";
    case "invalid_state":
    case "invalid_input":
      // These database messages are written for people (for example
      // "This version is already published").
      return databaseMessage ? withFullStop(databaseMessage) : WEBSITE_GENERIC_ERROR;
    default:
      return WEBSITE_GENERIC_ERROR;
  }
}

function withFullStop(message: string): string {
  const trimmed = message.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// ---------------------------------------------------------------------------
// Section editor

export const SECTION_TYPE_LABELS: Record<WebsiteSectionType, string> = {
  hero: "Hero",
  text: "Text",
  list: "List",
  faq: "FAQ",
  cta: "Call to action",
  banner: "Banner",
  program_showcase: "Featured Programs",
  contact_details: "Contact details",
  consent_text: "Consent text",
  menu: "Menu",
  footer_column: "Footer column",
};

export type ItemField = "title" | "text" | "question" | "answer" | "label" | "href";

export const ITEM_FIELDS: readonly ItemField[] = [
  "title",
  "text",
  "question",
  "answer",
  "label",
  "href",
];

export const ITEM_FIELD_LABELS: Record<ItemField, string> = {
  title: "Title",
  text: "Text",
  question: "Question",
  answer: "Answer",
  label: "Label",
  href: "Link",
};

export type SectionFieldSpec = {
  heading: boolean;
  body: boolean;
  cta: boolean;
  /** null: this section type has no item list. */
  items: { label: string; fields: readonly ItemField[] } | null;
  /** Shown to editors under the section. */
  note?: string;
};

/** The fields the editor offers for each section type. */
export const SECTION_FIELDS: Record<WebsiteSectionType, SectionFieldSpec> = {
  hero: { heading: true, body: true, cta: true, items: null },
  text: { heading: true, body: true, cta: false, items: null },
  list: {
    heading: true,
    body: true,
    cta: false,
    items: { label: "Points", fields: ["title", "text"] },
  },
  faq: {
    heading: true,
    body: false,
    cta: false,
    items: { label: "Questions", fields: ["question", "answer"] },
  },
  cta: { heading: true, body: true, cta: true, items: null },
  banner: { heading: true, body: true, cta: true, items: null },
  program_showcase: {
    heading: true,
    body: true,
    cta: true,
    items: null,
    note: "The featured Programs themselves come from published Program records, not from this text.",
  },
  contact_details: {
    heading: true,
    body: false,
    cta: false,
    items: { label: "Contact entries", fields: ["label", "text", "href"] },
  },
  consent_text: { heading: true, body: true, cta: false, items: null },
  menu: {
    heading: false,
    body: false,
    cta: false,
    items: { label: "Links", fields: ["label", "href"] },
  },
  footer_column: {
    heading: true,
    body: false,
    cta: false,
    items: { label: "Links", fields: ["label", "href"] },
  },
};

/** A unique section key for a new section, for example "faq" then "faq-2". */
export function nextSectionKey(
  type: WebsiteSectionType,
  existingKeys: readonly string[],
): string {
  const base = type.replace(/_/g, "-");
  if (!existingKeys.includes(base)) return base;
  let n = 2;
  while (existingKeys.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** An editable section as the editor holds it. */
export type EditableSection = {
  key: string;
  type: string;
  visible: boolean;
  heading?: string;
  body?: string;
  imageAssetId?: string;
  cta?: { label: string; href: string };
  items?: Array<Partial<Record<ItemField, string>>>;
};

const isBlank = (value: string | undefined): boolean =>
  value === undefined || value.trim() === "";

/**
 * Prepares a section for saving: blank optional text is left out, a call to
 * action with both fields blank is removed, and item rows left completely
 * blank are dropped. Anything partly filled in is kept, so validation can
 * explain it rather than it silently disappearing.
 */
export function cleanSectionForSave(section: EditableSection): EditableSection {
  const out: EditableSection = {
    key: section.key,
    type: section.type,
    visible: section.visible,
  };
  if (!isBlank(section.heading)) out.heading = section.heading;
  if (!isBlank(section.body)) out.body = section.body;
  if (section.imageAssetId) out.imageAssetId = section.imageAssetId;
  if (section.cta && !(isBlank(section.cta.label) && isBlank(section.cta.href))) {
    out.cta = { label: section.cta.label, href: section.cta.href.trim() };
  }
  if (section.items) {
    const items = section.items
      .map((item) => {
        const kept: Partial<Record<ItemField, string>> = {};
        for (const field of ITEM_FIELDS) {
          const value = item[field];
          if (!isBlank(value)) kept[field] = field === "href" ? value!.trim() : value;
        }
        return kept;
      })
      .filter((item) => Object.keys(item).length > 0);
    if (items.length > 0) out.items = items;
  }
  return out;
}

/** Item fields to show: the type's own fields plus any field already in use. */
export function itemFieldsToShow(
  type: WebsiteSectionType,
  items: ReadonlyArray<Partial<Record<ItemField, string>>> | undefined,
): ItemField[] {
  const own = SECTION_FIELDS[type]?.items?.fields ?? [];
  const used = new Set<ItemField>(own);
  for (const item of items ?? []) {
    for (const field of ITEM_FIELDS) {
      if (item[field] !== undefined && item[field] !== "") used.add(field);
    }
  }
  return ITEM_FIELDS.filter((f) => used.has(f));
}

// ---------------------------------------------------------------------------
// Display

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Display only, in India time; stored timestamps stay UTC. */
export function formatWebsiteTimestamp(iso: string | null): string {
  if (!iso) return "—";
  return `${TIMESTAMP_FORMAT.format(new Date(iso))} IST`;
}

/** Splits body text into paragraphs on blank lines (for the preview). */
export function bodyParagraphs(body: string | undefined): string[] {
  if (!body) return [];
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
