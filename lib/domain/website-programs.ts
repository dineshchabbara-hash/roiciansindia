import { STALE_EDIT_MESSAGE, type WebsiteErrorKind } from "@/lib/domain/website";
import type { WebsiteRegistrationState } from "@/lib/supabase/database.types";

/**
 * Phase 22B-2: Program Website Management rules (PHASE_22_APPROVED_DESIGN.md
 * §5.4, PHASE_22B_PLAN.md). Pure functions and labels only.
 *
 * Program website content lives in a `website_documents` row of kind
 * "program", separate from the LMS Program record: nothing is copied from the
 * LMS Program's own description, fees or internal fields. The public website
 * shows no pricing (P22-09) and no internal Batch facts (P22-10).
 */

// ---------------------------------------------------------------------------
// LMS Program and Batch statuses (shown to Admins for context only)

export type LmsProgramStatus = "draft" | "active" | "inactive" | "archived";

export const LMS_PROGRAM_STATUS_LABELS: Record<LmsProgramStatus, string> = {
  draft: "Draft in LMS",
  active: "Active in LMS",
  inactive: "Inactive in LMS",
  archived: "Archived in LMS",
};

/** website_publish_document() publishes a Program only while it is active. */
export function programCanBePublished(status: string): boolean {
  return status === "active";
}

/** website_create_program_document() refuses an archived Program. */
export function programCanGetWebsiteContent(status: string): boolean {
  return status !== "archived";
}

export const PROGRAM_NOT_ACTIVE_MESSAGE =
  "Only a Program that is active in the LMS can be published on the website. You can keep drafting and previewing its content.";

export type LmsBatchStatus =
  "draft" | "upcoming" | "active" | "completed" | "cancelled" | "archived";

export const LMS_BATCH_STATUS_LABELS: Record<LmsBatchStatus, string> = {
  draft: "Draft",
  upcoming: "Upcoming",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  archived: "Archived",
};

/** website_publish_batch() publishes only an upcoming or active Batch. */
export function batchCanBePublished(status: string): boolean {
  return status === "upcoming" || status === "active";
}

export const BATCH_NOT_PUBLISHABLE_MESSAGE =
  "Only an upcoming or active Batch can be published on the website.";

// ---------------------------------------------------------------------------
// Program slugs (P22-05, TI-7)

/**
 * Owner decision for 22B-2: a Program's public slug is not changed after its
 * first publication until redirect protection for old addresses is built and
 * verified. Enforced in the Admin UI and the server action, for Admin AND
 * Super Admin.
 *
 * The Phase 22A database still lets a Super Admin change a published slug
 * (it reserves the old slug in website_program_slug_history for a future
 * redirect). This application rule is stricter than the database.
 */
export function isProgramSlugLocked(firstPublishedAt: string | null): boolean {
  return firstPublishedAt !== null;
}

export const PUBLISHED_SLUG_LOCKED_MESSAGE =
  "This Program has been published, so its web address cannot be changed until redirects from old addresses are in place.";

// ---------------------------------------------------------------------------
// Batch website publication

export type BatchPublicationStatus =
  "not_set_up" | "draft" | "published" | "published_with_changes" | "unpublished";

export type BatchPublicationRow = {
  draftLabel: string | null;
  draftState: WebsiteRegistrationState;
  isPublished: boolean;
  publishedLabel: string | null;
  publishedState: WebsiteRegistrationState | null;
  firstPublishedAt: string | null;
  version: number;
};

export function batchPublicationStatus(
  pub: BatchPublicationRow | null,
): BatchPublicationStatus {
  if (!pub) return "not_set_up";
  if (!pub.isPublished) return pub.firstPublishedAt ? "unpublished" : "draft";
  const same =
    pub.draftLabel === pub.publishedLabel && pub.draftState === pub.publishedState;
  return same ? "published" : "published_with_changes";
}

export const BATCH_STATUS_LABELS: Record<BatchPublicationStatus, string> = {
  not_set_up: "Not on the website",
  draft: "Draft",
  published: "Published",
  published_with_changes: "Published, with unpublished changes",
  unpublished: "Unpublished",
};

export const BATCH_STATUS_BADGE_VARIANTS: Record<
  BatchPublicationStatus,
  "outline" | "secondary" | "success" | "warning"
> = {
  not_set_up: "outline",
  draft: "secondary",
  published: "success",
  published_with_changes: "warning",
  unpublished: "secondary",
};

export const BATCH_LABEL_HINT =
  'Shown publicly, for example "Weekend batch, starts 7 March". Do not include seat counts, prices, meeting links, locations, Trainer names or internal notes.';

// ---------------------------------------------------------------------------
// Ordering

/**
 * The list with one item moved one place up or down. Returns null when the
 * move is not possible (unknown item, or already first/last).
 */
export function moveInList<T>(
  items: readonly T[],
  index: number,
  direction: "up" | "down",
): T[] | null {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return null;
  }
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export type FeaturedItem = { documentId: string; featuredOrder: number | null };

/**
 * Featured Programs in display order: by featured order, then (for equal or
 * missing orders) by the given tie-break name.
 */
export function sortFeatured<T extends FeaturedItem & { name: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => {
    const ao = a.featuredOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.featuredOrder ?? Number.MAX_SAFE_INTEGER;
    return ao - bo || a.name.localeCompare(b.name);
  });
}

/**
 * The featured-order changes needed so the given order becomes 1, 2, 3...
 * Only items whose order actually changes are returned.
 */
export function featuredOrderChanges(
  ordered: readonly FeaturedItem[],
): Array<{ documentId: string; featuredOrder: number }> {
  return ordered
    .map((item, i) => ({
      documentId: item.documentId,
      featuredOrder: i + 1,
      was: item.featuredOrder,
    }))
    .filter((c) => c.was !== c.featuredOrder)
    .map(({ documentId, featuredOrder }) => ({ documentId, featuredOrder }));
}

/** The next featured position (after every current featured Program). */
export function nextFeaturedOrder(orders: ReadonlyArray<number | null>): number {
  const max = orders.reduce<number>((m, o) => (o !== null && o > m ? o : m), 0);
  return Math.min(max + 1, 10000);
}

// ---------------------------------------------------------------------------
// Messages for database outcomes

const GENERIC = "Something went wrong. Please try again.";

function withFullStop(message: string): string {
  const trimmed = message.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Plain-language message for a database error from the Program, display
 * group or Batch publication functions. Their duplicate, slug, state and
 * input messages are written for people, so those are shown as they are.
 */
export function programWebsiteMessage(
  kind: WebsiteErrorKind,
  databaseMessage?: string | null,
): string {
  switch (kind) {
    case "not_allowed":
      return "Only an active Admin or Super Admin can manage website content.";
    case "stale":
      return STALE_EDIT_MESSAGE;
    case "not_found":
      return "This item no longer exists. Reload the page.";
    case "duplicate":
    case "slug_unavailable":
    case "invalid_state":
    case "invalid_input":
      return databaseMessage ? withFullStop(databaseMessage) : GENERIC;
    default:
      return GENERIC;
  }
}
