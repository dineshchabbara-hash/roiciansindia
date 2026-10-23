import type {
  WebsiteDocumentKind,
  WebsiteRegistrationState,
} from "@/lib/supabase/database.types";

/**
 * Phase 22A — Website Management domain rules
 * (docs/requirements/PHASE_22_APPROVED_DESIGN.md §5, §7, §8, §9).
 *
 * Mirrors the database rules in 20260101000040_website_content_foundation.sql
 * and 20260101000041_program_deletion_safeguards.sql so the Phase 22B editor
 * can explain a problem before the round trip. The database functions remain
 * the authority: they re-check the session, every limit and every rule.
 */

export const WEBSITE_DOCUMENT_KINDS: readonly WebsiteDocumentKind[] = [
  "home",
  "about",
  "corporate_training",
  "institutions",
  "contact",
  "legal",
  "navigation",
  "footer",
  "program",
  "programs_listing",
  "upcoming_batches",
];

/** Kinds with at most one document (one Home, one footer, ...). */
export const SINGLETON_DOCUMENT_KINDS: readonly WebsiteDocumentKind[] = [
  "home",
  "about",
  "corporate_training",
  "institutions",
  "contact",
  "navigation",
  "footer",
  "programs_listing",
  "upcoming_batches",
];

export type WebsiteSectionType =
  | "hero"
  | "text"
  | "list"
  | "faq"
  | "cta"
  | "banner"
  | "program_showcase"
  | "contact_details"
  | "consent_text"
  | "menu"
  | "footer_column";

/** Same table as website_allowed_section_types() in migration 40. */
export const SECTION_TYPES_BY_KIND: Record<
  WebsiteDocumentKind,
  readonly WebsiteSectionType[]
> = {
  program: ["text", "list", "faq", "cta"],
  home: ["hero", "text", "list", "faq", "cta", "banner", "program_showcase"],
  about: ["hero", "text", "list", "faq", "cta", "banner"],
  corporate_training: ["hero", "text", "list", "faq", "cta", "banner"],
  institutions: ["hero", "text", "list", "faq", "cta", "banner"],
  contact: ["hero", "text", "contact_details", "cta"],
  legal: ["text", "consent_text"],
  navigation: ["menu"],
  footer: ["footer_column", "text"],
  // Intro, FAQs and supporting sections only; the Programs and Batches shown
  // on these pages come from their own published records (22C), never text.
  programs_listing: ["hero", "text", "list", "faq", "cta", "banner"],
  upcoming_batches: ["hero", "text", "list", "faq", "cta", "banner"],
};

export const REGISTRATION_STATES: readonly WebsiteRegistrationState[] = [
  "open",
  "closed",
  "full",
];

export const REGISTRATION_STATE_LABELS: Record<WebsiteRegistrationState, string> = {
  open: "Open",
  closed: "Closed",
  full: "Full",
};

/** Text limits shared with the database. */
export const WEBSITE_LIMITS = {
  title: 150,
  summary: 500,
  seoTitle: 70,
  seoDescription: 170,
  socialTitle: 100,
  socialDescription: 200,
  sectionHeading: 150,
  sectionBody: 5000,
  sectionKey: 40,
  sections: 40,
  items: 50,
  ctaLabel: 60,
  itemLabel: 80,
  itemTitle: 200,
  itemText: 2000,
  groupName: 80,
  groupDescription: 300,
  batchLabel: 120,
  altText: 250,
  deletionReason: 500,
} as const;

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidWebsiteSlug(slug: string): boolean {
  return slug.length >= 3 && slug.length <= 100 && SLUG_PATTERN.test(slug);
}

/** A suggested slug for a Program name (never applied automatically). */
export function suggestSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
}

export function isValidSectionKey(key: string): boolean {
  return key.length <= WEBSITE_LIMITS.sectionKey && SLUG_PATTERN.test(key);
}

/** HTML-like tags are refused in every website text field. */
export function containsMarkup(value: string): boolean {
  return /<[A-Za-z/!?]/.test(value);
}

/**
 * P22-09: the public website shows no pricing. Catches the rupee sign and the
 * common written forms: "Rs 4,999", "Rs.4999", "INR 50000" and "4,999/-".
 * The database itself refuses only the rupee sign (website_clean_text); this
 * application check is deliberately stricter.
 */
export function containsPrice(value: string): boolean {
  return (
    value.includes("₹") ||
    /\b(?:rs|inr)\.?\s*\d/i.test(value) ||
    /\d[\d,.]*\s*\/-/.test(value)
  );
}

/** Same rule as website_is_safe_href(): site path, https, mailto: or tel:. */
export function isSafeWebsiteHref(href: string): boolean {
  if (href.length === 0 || href.length > 500) return false;
  if (/[<>"'`\\]/.test(href)) return false;
  if (!href.startsWith("tel:") && /\s/.test(href)) return false;
  if (href.startsWith("/")) return !href.startsWith("//");
  if (
    /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?(\/.*)?$/i.test(
      href,
    )
  ) {
    return true;
  }
  if (/^mailto:[^@/:]+@[a-z0-9.-]+$/i.test(href)) return true;
  return /^tel:\+?[0-9][0-9 -]{3,20}$/.test(href);
}

/**
 * P22-05: after a Program's first publication only a Super Admin may change
 * its slug (the database trigger enforces this for every writer).
 */
export function canChangeProgramSlug(input: {
  isSuperAdmin: boolean;
  firstPublishedAt: string | null;
}): boolean {
  return input.firstPublishedAt === null || input.isSuperAdmin;
}

/** A document has unpublished edits when its latest revision is not live. */
export function hasUnpublishedChanges(doc: {
  latest_revision_id: string | null;
  published_revision_id: string | null;
}): boolean {
  return (
    doc.latest_revision_id !== null &&
    doc.latest_revision_id !== doc.published_revision_id
  );
}

// ---------------------------------------------------------------------------
// Database error codes raised by the website and deletion functions.

export type WebsiteErrorKind =
  | "not_allowed"
  | "stale"
  | "not_found"
  | "slug_unavailable"
  | "invalid_state"
  | "invalid_input"
  | "duplicate"
  | "deletion_blocked"
  | "unknown";

const ERROR_KINDS: Record<string, WebsiteErrorKind> = {
  "42501": "not_allowed",
  P2203: "stale",
  P2204: "not_found",
  P2205: "slug_unavailable",
  P2206: "invalid_state",
  "22023": "invalid_input",
  "23505": "duplicate",
  P2201: "deletion_blocked",
};

export function websiteErrorKind(code: string | null | undefined): WebsiteErrorKind {
  return (code && ERROR_KINDS[code]) || "unknown";
}

export const STALE_EDIT_MESSAGE =
  "Someone else changed this content after you opened it. Reload to see the latest version, then reapply your change.";

// ---------------------------------------------------------------------------
// Program deletion eligibility (§7). The Phase 22B review screen shows these.

export const PROGRAM_DELETION_ALTERNATIVE =
  "It can remain archived, and its historical records will be preserved.";

const DEPENDENCY_LABELS: Record<string, string> = {
  batches: "linked Batches",
  enrollments: "enrollments",
  certificates: "certificates",
  program_modules: "curriculum modules",
  materials: "learning materials",
  assignments: "assignments",
  leads: "enquiry records",
  website_documents: "website content",
};

/** Plain-language reason for one blocker code from program_deletion_blockers(). */
export function describeProgramDeletionBlocker(code: string): string {
  if (code.startsWith("dependency:")) {
    const table = code.slice("dependency:".length);
    return DEPENDENCY_LABELS[table] ?? `linked ${table.replace(/_/g, " ")}`;
  }
  switch (code) {
    case "not_found":
      return "the Program no longer exists";
    case "not_archived":
      return "it is not archived";
    case "uncertain_dependency":
      return "a linked record that cannot be checked safely";
    case "stored_file_reference":
      return "a stored thumbnail file";
    case "stored_files":
      return "stored files filed under it";
    case "website_published_history":
      return "website content that was published before";
    case "website_link_reference":
      return "website pages that link to it";
    case "audit_history":
      return "recorded training, financial or other protected history";
    case "unattributable_history":
      return "training or financial history from while it existed that can no longer be linked to any Program";
    default:
      return "a protected record";
  }
}

/** Splits the P2201 error detail ("a, b") into blocker codes. */
export function parseDeletionBlockerDetail(detail: string | null | undefined): string[] {
  if (!detail) return [];
  return detail
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * §7.4 explanation, e.g. "This Program cannot be permanently deleted because
 * it has linked Batches and enrollments. It can remain archived, and its
 * historical records will be preserved."
 */
export function programDeletionBlockedMessage(codes: string[]): string {
  if (codes.length === 0) {
    return "This Program has no recorded blockers at this moment; deletion is rechecked when confirmed.";
  }
  const unique = [...new Set(codes)];
  const state = unique.includes("not_archived");
  const reasons = unique
    .filter((c) => c !== "not_archived" && c !== "not_found")
    .map(describeProgramDeletionBlocker);
  if (unique.includes("not_found")) {
    return "This Program no longer exists.";
  }
  const parts: string[] = [];
  if (state) parts.push("it is not archived");
  if (reasons.length > 0) parts.push(`it has ${joinWithAnd(reasons)}`);
  return `This Program cannot be permanently deleted because ${parts.join(
    " and ",
  )}. ${PROGRAM_DELETION_ALTERNATIVE}`;
}
