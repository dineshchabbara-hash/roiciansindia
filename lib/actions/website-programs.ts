"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import { STALE_EDIT_MESSAGE } from "@/lib/domain/website";
import {
  GROUP_HAS_PROGRAMS_MESSAGE,
  PROGRAM_NOT_ACTIVE_MESSAGE,
  PUBLISHED_SLUG_LOCKED_MESSAGE,
  featuredOrderChanges,
  isProgramSlugLocked,
  moveInList,
  nextFeaturedOrder,
  programCanBePublished,
  programCanGetWebsiteContent,
} from "@/lib/domain/website-programs";
import {
  isUuid,
  publishWebsitePage,
  restoreWebsiteRevision,
  saveWebsiteDraft,
  unpublishWebsitePage,
} from "@/lib/data/website";
import {
  changeProgramSlug,
  createDisplayGroup,
  createProgramWebsite,
  getBatchProgramId,
  getPlacementRows,
  getProgramWebsite,
  listDisplayGroups,
  listProgramWebsiteEntries,
  publishBatch,
  reorderDisplayGroups,
  saveBatchPublication,
  setDisplayGroupArchived,
  unpublishBatch,
  updateDisplayGroup,
  updateProgramPlacement,
} from "@/lib/data/website-programs";
import {
  batchPublicationSchema,
  displayGroupSchema,
  websiteDraftSchema,
  websiteSlugSchema,
} from "@/lib/validation/website";
import type { WebsiteActionState } from "@/lib/actions/website";
import type { WebsiteRegistrationState } from "@/lib/supabase/database.types";

/**
 * Phase 22B-2: Program Website Management actions.
 *
 * Admin and Super Admin only: checked here from the session, then again by the
 * Phase 22A database functions (which also refuse an INACTIVE Admin, enforce
 * version checks and write the audit log). Every write names the document,
 * group or Batch version the Admin was looking at, so a concurrent change is
 * refused instead of overwritten.
 *
 * Application rules stricter than the database:
 *   - a published Program's slug is not changed, by anyone, until redirect
 *     protection exists (isProgramSlugLocked);
 *   - a Program that is not active in the LMS is not sent to publication.
 */

export type ProgramActionState = WebsiteActionState & {
  /** New version after a successful settings change. */
  version?: number;
};

const NOT_AUTHORIZED = "Only an Admin or Super Admin can manage website content.";
const UNREADABLE = "This request could not be read. Reload the page and try again.";
const LIST_CHANGED =
  "The list changed while you were viewing it. Reload the page and try again.";

async function authorized(): Promise<boolean> {
  const ctx = await getCurrentUserContext();
  return Boolean(ctx && isAdminOrSuperAdmin(ctx.role));
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function wholeNumber(formData: FormData, name: string): number | null {
  const raw = text(formData, name);
  if (!/^\d{1,9}$/.test(raw)) return null;
  return Number(raw);
}

/** Optional position 1-10000: "" means none; anything else invalid is null. */
function position(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d{1,5}$/.test(trimmed)) return { ok: false };
  const n = Number(trimmed);
  return n >= 1 && n <= 10000 ? { ok: true, value: n } : { ok: false };
}

function refused(
  error: string,
  extra: Partial<ProgramActionState> = {},
): ProgramActionState {
  return { error, attempt: Date.now(), ...extra };
}

function fieldErrorsFrom(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

function revalidateProgram(documentId?: string) {
  revalidatePath("/admin/website/programs");
  revalidatePath("/admin/website/featured");
  revalidatePath("/admin/website/groups");
  if (documentId) revalidatePath(`/admin/website/programs/${documentId}`, "layout");
}

// ---------------------------------------------------------------------------
// Program website content

export async function createProgramWebsiteAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const programId = text(formData, "programId");
  if (!isUuid(programId)) return refused(UNREADABLE);

  const slug = websiteSlugSchema.safeParse(text(formData, "slug"));
  if (!slug.success) {
    return refused("Check the web address.", {
      fieldErrors: { slug: slug.error.issues.map((i) => i.message) },
    });
  }

  const entries = await listProgramWebsiteEntries();
  if (!entries.ok) return refused(entries.error);
  const entry = entries.data.find((e) => e.program.id === programId);
  if (!entry) return refused("This Program could not be found. Reload the page.");
  if (entry.document) {
    redirect(`/admin/website/programs/${entry.document.id}`);
  }
  if (!programCanGetWebsiteContent(entry.program.status)) {
    return refused("An archived Program cannot get website content.");
  }

  const result = await createProgramWebsite(programId, slug.data);
  if (!result.ok) {
    return refused(
      result.error,
      result.kind === "slug_unavailable" ? { fieldErrors: { slug: [result.error] } } : {},
    );
  }
  revalidateProgram();
  redirect(`/admin/website/programs/${result.data.id}`);
}

export async function saveProgramDraftAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const documentId = text(formData, "documentId");
  if (!isUuid(documentId)) return refused(UNREADABLE);

  let payload: unknown;
  try {
    payload = JSON.parse(text(formData, "draft"));
  } catch {
    return refused(UNREADABLE);
  }

  const entry = await getProgramWebsite(documentId);
  if (!entry.ok) return refused(entry.error);

  const parsed = websiteDraftSchema("program").safeParse(payload);
  if (!parsed.success) {
    return refused("Check the highlighted fields.", {
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    });
  }
  const draft = parsed.data;
  const result = await saveWebsiteDraft({
    documentId,
    baseRevisionNumber: draft.baseRevisionNumber,
    title: draft.title,
    summary: draft.summary,
    seoTitle: draft.seoTitle,
    seoDescription: draft.seoDescription,
    socialTitle: draft.socialTitle,
    socialDescription: draft.socialDescription,
    heroImageAssetId: draft.heroImageAssetId,
    socialImageAssetId: draft.socialImageAssetId,
    sections: draft.sections,
  });
  if (!result.ok) {
    if (result.kind === "stale") {
      const fresh = await getProgramWebsite(documentId);
      return refused(STALE_EDIT_MESSAGE, {
        stale: {
          latestRevisionNumber: fresh.ok
            ? fresh.data.document.latestRevisionNumber
            : draft.baseRevisionNumber,
        },
      });
    }
    return refused(result.error);
  }
  revalidateProgram(documentId);
  return {
    message: `Draft saved as version ${result.data.revisionNumber}. It is not public until you publish it.`,
    saved: result.data,
  };
}

export async function publishProgramAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const documentId = text(formData, "documentId");
  const revisionId = text(formData, "revisionId");
  if (!isUuid(documentId) || !isUuid(revisionId)) return refused(UNREADABLE);

  const entry = await getProgramWebsite(documentId);
  if (!entry.ok) return refused(entry.error);
  if (!programCanBePublished(entry.data.program.status)) {
    return refused(PROGRAM_NOT_ACTIVE_MESSAGE);
  }

  const result = await publishWebsitePage(documentId, revisionId);
  if (!result.ok) {
    return refused(
      result.error,
      result.kind === "stale"
        ? { stale: { latestRevisionNumber: entry.data.document.latestRevisionNumber } }
        : {},
    );
  }
  revalidateProgram(documentId);
  return {
    message: "Published. This version is now the live content for this Program.",
  };
}

export async function unpublishProgramAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const documentId = text(formData, "documentId");
  const expectedVersion = wholeNumber(formData, "expectedVersion");
  if (!isUuid(documentId) || expectedVersion === null) return refused(UNREADABLE);

  const entry = await getProgramWebsite(documentId);
  if (!entry.ok) return refused(entry.error);

  const result = await unpublishWebsitePage(documentId, expectedVersion);
  if (!result.ok) return refused(result.error);
  revalidateProgram(documentId);
  return {
    message:
      "Unpublished. This Program has no live content now; its drafts, history and web address are kept.",
  };
}

export async function restoreProgramRevisionAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const documentId = text(formData, "documentId");
  const sourceRevisionId = text(formData, "sourceRevisionId");
  const baseRevisionNumber = wholeNumber(formData, "baseRevisionNumber");
  if (!isUuid(documentId) || !isUuid(sourceRevisionId) || baseRevisionNumber === null) {
    return refused(UNREADABLE);
  }
  const entry = await getProgramWebsite(documentId);
  if (!entry.ok) return refused(entry.error);

  const result = await restoreWebsiteRevision(
    documentId,
    sourceRevisionId,
    baseRevisionNumber,
  );
  if (!result.ok) return refused(result.error);
  revalidateProgram(documentId);
  redirect(
    `/admin/website/programs/${documentId}?restored=${result.data.revisionNumber}`,
  );
}

// ---------------------------------------------------------------------------
// Web address and placement

export async function changeProgramSlugAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const documentId = text(formData, "documentId");
  const expectedVersion = wholeNumber(formData, "expectedVersion");
  if (!isUuid(documentId) || expectedVersion === null) return refused(UNREADABLE);

  const entry = await getProgramWebsite(documentId);
  if (!entry.ok) return refused(entry.error);
  // Owner rule: no slug change after first publication, for anyone, until
  // redirect protection exists. Refused before any database call.
  if (isProgramSlugLocked(entry.data.document.firstPublishedAt)) {
    return refused(PUBLISHED_SLUG_LOCKED_MESSAGE);
  }

  const slug = websiteSlugSchema.safeParse(text(formData, "slug"));
  if (!slug.success) {
    return refused("Check the web address.", {
      fieldErrors: { slug: slug.error.issues.map((i) => i.message) },
    });
  }
  if (slug.data === entry.data.document.slug) {
    return refused("The web address is unchanged.");
  }

  const result = await changeProgramSlug(documentId, expectedVersion, slug.data);
  if (!result.ok) {
    return refused(
      result.error,
      result.kind === "slug_unavailable" ? { fieldErrors: { slug: [result.error] } } : {},
    );
  }
  revalidateProgram(documentId);
  return { message: "Web address changed.", version: result.data.version };
}

export async function updateProgramPlacementAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const documentId = text(formData, "documentId");
  const expectedVersion = wholeNumber(formData, "expectedVersion");
  if (!isUuid(documentId) || expectedVersion === null) return refused(UNREADABLE);

  const groupRaw = text(formData, "displayGroupId");
  if (groupRaw !== "" && !isUuid(groupRaw)) return refused(UNREADABLE);
  const displayOrder = position(text(formData, "displayOrder"));
  const featuredOrderInput = position(text(formData, "featuredOrder"));
  const fieldErrors: Record<string, string[]> = {};
  if (!displayOrder.ok)
    fieldErrors.displayOrder = ["Enter a whole number from 1 to 10000."];
  if (!featuredOrderInput.ok) {
    fieldErrors.featuredOrder = ["Enter a whole number from 1 to 10000."];
  }
  if (!displayOrder.ok || !featuredOrderInput.ok) {
    return refused("Check the highlighted fields.", { fieldErrors });
  }
  const isFeatured = text(formData, "isFeatured") === "on";

  let featuredOrder = isFeatured ? featuredOrderInput.value : null;
  if (isFeatured && featuredOrder === null) {
    const entries = await listProgramWebsiteEntries();
    if (!entries.ok) return refused(entries.error);
    featuredOrder = nextFeaturedOrder(
      entries.data
        .filter((e) => e.document?.placement.isFeatured && e.document.id !== documentId)
        .map((e) => e.document!.placement.featuredOrder),
    );
  }

  const result = await updateProgramPlacement(documentId, expectedVersion, {
    displayGroupId: groupRaw === "" ? null : groupRaw,
    isFeatured,
    displayOrder: displayOrder.value,
    featuredOrder,
  });
  if (!result.ok) return refused(result.error);
  revalidateProgram(documentId);
  return {
    message: "Placement saved. It applies to the public website straight away.",
    version: result.data.version,
  };
}

// ---------------------------------------------------------------------------
// Featured Programs

type SeenItem = { id: string; version: number };

function parseSeen(raw: string): SeenItem[] | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value) || value.length === 0 || value.length > 200) return null;
    const items: SeenItem[] = [];
    for (const v of value) {
      if (!v || typeof v !== "object") return null;
      const { id, version } = v as Record<string, unknown>;
      if (!isUuid(id) || typeof version !== "number" || !Number.isInteger(version)) {
        return null;
      }
      items.push({ id, version });
    }
    return new Set(items.map((i) => i.id)).size === items.length ? items : null;
  } catch {
    return null;
  }
}

/**
 * Moves one featured Program up or down. The browser sends the featured list
 * (ids and versions) as it was shown; if anything changed since, nothing is
 * written. Each position change is a separate, version-checked and audited
 * placement update (Phase 22A has no all-at-once featured reorder).
 */
export async function moveFeaturedProgramAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const documentId = text(formData, "documentId");
  const direction = text(formData, "direction");
  const seen = parseSeen(text(formData, "seen"));
  if (!isUuid(documentId) || (direction !== "up" && direction !== "down") || !seen) {
    return refused(UNREADABLE);
  }

  const entries = await listProgramWebsiteEntries();
  if (!entries.ok) return refused(entries.error);
  const featuredNow = new Set(
    entries.data
      .filter((e) => e.document?.placement.isFeatured)
      .map((e) => e.document!.id),
  );
  if (featuredNow.size !== seen.length || seen.some((s) => !featuredNow.has(s.id))) {
    return refused(LIST_CHANGED);
  }

  const fresh = await getPlacementRows(seen.map((s) => s.id));
  if (!fresh.ok) return refused(fresh.error);
  if (seen.some((s) => fresh.data.get(s.id)?.version !== s.version)) {
    return refused(LIST_CHANGED);
  }

  const index = seen.findIndex((s) => s.id === documentId);
  const moved = moveInList(seen, index, direction);
  if (!moved) return refused("That Program cannot move further.");

  const changes = featuredOrderChanges(
    moved.map((s) => ({
      documentId: s.id,
      featuredOrder: fresh.data.get(s.id)!.placement.featuredOrder,
    })),
  );
  for (const change of changes) {
    const row = fresh.data.get(change.documentId)!;
    const result = await updateProgramPlacement(change.documentId, row.version, {
      ...row.placement,
      isFeatured: true,
      featuredOrder: change.featuredOrder,
    });
    if (!result.ok) {
      revalidateProgram();
      return refused(
        `${result.error} Some positions may already have changed; reload the page to see the current order.`,
      );
    }
  }
  revalidateProgram();
  return {
    message: "Featured order saved. It applies to the public website straight away.",
  };
}

export async function removeFeaturedProgramAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const documentId = text(formData, "documentId");
  const expectedVersion = wholeNumber(formData, "expectedVersion");
  if (!isUuid(documentId) || expectedVersion === null) return refused(UNREADABLE);

  const fresh = await getPlacementRows([documentId]);
  if (!fresh.ok) return refused(fresh.error);
  const row = fresh.data.get(documentId);
  if (!row) return refused("This Program could not be found. Reload the page.");
  if (row.version !== expectedVersion) return refused(STALE_EDIT_MESSAGE);
  if (!row.placement.isFeatured) return refused("This Program is not featured.");

  const result = await updateProgramPlacement(documentId, expectedVersion, {
    ...row.placement,
    isFeatured: false,
    featuredOrder: null,
  });
  if (!result.ok) return refused(result.error);
  revalidateProgram(documentId);
  return { message: "Removed from featured Programs." };
}

// ---------------------------------------------------------------------------
// Display groups

export async function createDisplayGroupAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const parsed = displayGroupSchema.safeParse({
    name: text(formData, "name"),
    description: text(formData, "description"),
    isVisible: true,
  });
  if (!parsed.success) {
    return refused("Check the highlighted fields.", {
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    });
  }
  const result = await createDisplayGroup(parsed.data.name, parsed.data.description);
  if (!result.ok) {
    return refused(
      result.error,
      result.kind === "duplicate" ? { fieldErrors: { name: [result.error] } } : {},
    );
  }
  revalidateProgram();
  return { message: `Display group "${parsed.data.name}" created.` };
}

export async function updateDisplayGroupAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const groupId = text(formData, "groupId");
  const expectedVersion = wholeNumber(formData, "expectedVersion");
  if (!isUuid(groupId) || expectedVersion === null) return refused(UNREADABLE);
  const parsed = displayGroupSchema.safeParse({
    name: text(formData, "name"),
    description: text(formData, "description"),
    isVisible: text(formData, "isVisible") === "on",
  });
  if (!parsed.success) {
    return refused("Check the highlighted fields.", {
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    });
  }
  const result = await updateDisplayGroup(groupId, expectedVersion, parsed.data);
  if (!result.ok) {
    return refused(
      result.error,
      result.kind === "duplicate" ? { fieldErrors: { name: [result.error] } } : {},
    );
  }
  revalidateProgram();
  return { message: "Display group saved.", version: result.data.version };
}

export async function moveDisplayGroupAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const groupId = text(formData, "groupId");
  const direction = text(formData, "direction");
  let seen: unknown;
  try {
    seen = JSON.parse(text(formData, "orderedIds"));
  } catch {
    return refused(UNREADABLE);
  }
  if (
    !isUuid(groupId) ||
    (direction !== "up" && direction !== "down") ||
    !Array.isArray(seen) ||
    !seen.every(isUuid)
  ) {
    return refused(UNREADABLE);
  }
  const ids = seen as string[];
  const moved = moveInList(ids, ids.indexOf(groupId), direction);
  if (!moved) return refused("That group cannot move further.");

  // The database refuses the new order unless it covers exactly the current
  // active groups, so a concurrent create or reorder is caught there too.
  const current = await listDisplayGroups();
  if (!current.ok) return refused(current.error);
  const currentIds = current.data.map((g) => g.id);
  if (currentIds.length !== ids.length || currentIds.some((id, i) => id !== ids[i])) {
    return refused(LIST_CHANGED);
  }

  const result = await reorderDisplayGroups(moved);
  if (!result.ok) return refused(result.error);
  revalidateProgram();
  return {
    message: "Group order saved. It applies to the public website straight away.",
  };
}

/**
 * Archives an active display group (confirmed in the screen first). A group
 * that still holds Programs is refused here with the reason, and again by the
 * database; hiding the group is the alternative. The version the Admin was
 * looking at is sent, so a concurrent change is refused.
 */
export async function archiveDisplayGroupAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const groupId = text(formData, "groupId");
  const expectedVersion = wholeNumber(formData, "expectedVersion");
  if (!isUuid(groupId) || expectedVersion === null) return refused(UNREADABLE);

  const current = await listDisplayGroups();
  if (!current.ok) return refused(current.error);
  const group = current.data.find((g) => g.id === groupId);
  if (!group) return refused(LIST_CHANGED);
  if (group.programCount > 0) return refused(GROUP_HAS_PROGRAMS_MESSAGE);

  const result = await setDisplayGroupArchived(groupId, expectedVersion, true);
  if (!result.ok) return refused(result.error);
  revalidateProgram();
  return {
    message: `Display group "${group.name}" archived. It no longer appears on the website. You can restore it from Archived groups.`,
  };
}

/**
 * Restores an archived display group. The database refuses it if an active
 * group now uses the same name, and puts the restored group last in the
 * display order with its visibility unchanged.
 */
export async function restoreDisplayGroupAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const groupId = text(formData, "groupId");
  const expectedVersion = wholeNumber(formData, "expectedVersion");
  if (!isUuid(groupId) || expectedVersion === null) return refused(UNREADABLE);

  const result = await setDisplayGroupArchived(groupId, expectedVersion, false);
  if (!result.ok) return refused(result.error);
  revalidateProgram();
  return {
    message:
      "Display group restored. It is now last in the display order, and its visibility setting is unchanged.",
  };
}

// ---------------------------------------------------------------------------
// Batch website publication

async function batchInProgram(
  formData: FormData,
): Promise<
  | { ok: true; documentId: string; batchId: string; expectedVersion: number }
  | { ok: false; state: ProgramActionState }
> {
  if (!(await authorized())) return { ok: false, state: refused(NOT_AUTHORIZED) };
  const documentId = text(formData, "documentId");
  const batchId = text(formData, "batchId");
  const expectedVersion = wholeNumber(formData, "expectedVersion");
  if (!isUuid(documentId) || !isUuid(batchId) || expectedVersion === null) {
    return { ok: false, state: refused(UNREADABLE) };
  }
  const entry = await getProgramWebsite(documentId);
  if (!entry.ok) return { ok: false, state: refused(entry.error) };
  const programId = await getBatchProgramId(batchId);
  if (programId !== entry.data.program.id) {
    return { ok: false, state: refused("This Batch does not belong to this Program.") };
  }
  return { ok: true, documentId, batchId, expectedVersion };
}

export async function saveBatchPublicationAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  const target = await batchInProgram(formData);
  if (!target.ok) return target.state;
  const parsed = batchPublicationSchema.safeParse({
    publicLabel: text(formData, "publicLabel"),
    registrationState: text(formData, "registrationState"),
  });
  if (!parsed.success) {
    return refused("Check the highlighted fields.", {
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    });
  }
  const result = await saveBatchPublication(target.batchId, target.expectedVersion, {
    publicLabel: parsed.data.publicLabel,
    registrationState: parsed.data.registrationState as WebsiteRegistrationState,
  });
  if (!result.ok) return refused(result.error);
  revalidateProgram(target.documentId);
  return {
    message: "Saved. Publish the Batch for the change to appear on the website.",
    version: result.data.version,
  };
}

export async function publishBatchAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  const target = await batchInProgram(formData);
  if (!target.ok) return target.state;
  const result = await publishBatch(target.batchId, target.expectedVersion);
  if (!result.ok) return refused(result.error);
  revalidateProgram(target.documentId);
  return {
    message: "Batch published with its public label and registration state.",
    version: result.data.version,
  };
}

export async function unpublishBatchAction(
  _prev: ProgramActionState,
  formData: FormData,
): Promise<ProgramActionState> {
  const target = await batchInProgram(formData);
  if (!target.ok) return target.state;
  const result = await unpublishBatch(target.batchId, target.expectedVersion);
  if (!result.ok) return refused(result.error);
  revalidateProgram(target.documentId);
  return { message: "Batch removed from the website.", version: result.data.version };
}
