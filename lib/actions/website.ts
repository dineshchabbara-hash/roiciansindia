"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import { STALE_EDIT_MESSAGE } from "@/lib/domain/website";
import {
  DEFAULT_PAGE_KEYS,
  LEGAL_PUBLICATION_HELD_MESSAGE,
  isAdminPageKind,
  isPublicationHeld,
  isSingletonPageKind,
  legalPageKeyProblem,
} from "@/lib/domain/website-admin";
import {
  createWebsitePage,
  getWebsitePage,
  isUuid,
  publishWebsitePage,
  restoreWebsiteRevision,
  saveWebsiteDraft,
  unpublishWebsitePage,
} from "@/lib/data/website";
import { websiteDraftSchema } from "@/lib/validation/website";

/**
 * Phase 22B-1: Admin Website Management actions (PHASE_22B_PLAN.md §4).
 *
 * Admin and Super Admin only: checked here from the session, then again by the
 * Phase 22A database functions, which also refuse an INACTIVE Admin and write
 * the audit log. Input is validated against the page type loaded from the
 * database, never a type sent by the browser.
 *
 * Legal pages: publication is refused here until their wording is approved
 * (C4). This is an application-level hold only; see isPublicationHeld().
 */

export type WebsiteActionState = {
  error?: string;
  message?: string;
  /** Field errors keyed by path, for example "title" or "sections.2.cta.href". */
  fieldErrors?: Record<string, string[]>;
  /** Set when someone else saved first; the editor keeps the user's text. */
  stale?: { latestRevisionNumber: number };
  saved?: { revisionId: string; revisionNumber: number };
  /** Changes on every refused submit. */
  attempt?: number;
};

const NOT_AUTHORIZED = "Only an Admin or Super Admin can manage website content.";
const UNREADABLE = "This request could not be read. Reload the page and try again.";

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

function revalidatePage(documentId?: string) {
  revalidatePath("/admin/website");
  if (documentId) revalidatePath(`/admin/website/pages/${documentId}`, "layout");
}

function refused(
  error: string,
  extra: Partial<WebsiteActionState> = {},
): WebsiteActionState {
  return { error, attempt: Date.now(), ...extra };
}

// ---------------------------------------------------------------------------

export async function createWebsitePageAction(
  _prev: WebsiteActionState,
  formData: FormData,
): Promise<WebsiteActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);

  const kind = text(formData, "kind");
  if (!isAdminPageKind(kind)) return refused("Choose a supported page type.");

  let pageKey: string;
  if (isSingletonPageKind(kind)) {
    pageKey = DEFAULT_PAGE_KEYS[kind];
  } else {
    pageKey = text(formData, "pageKey").trim();
    const problem = legalPageKeyProblem(pageKey);
    if (problem) {
      return refused("Check the page key.", { fieldErrors: { pageKey: [problem] } });
    }
  }

  const result = await createWebsitePage(kind, pageKey);
  if (!result.ok) return refused(result.error);

  revalidatePage();
  redirect(`/admin/website/pages/${result.data.id}`);
}

export async function saveWebsiteDraftAction(
  _prev: WebsiteActionState,
  formData: FormData,
): Promise<WebsiteActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);

  const documentId = text(formData, "documentId");
  if (!isUuid(documentId)) return refused(UNREADABLE);

  let payload: unknown;
  try {
    payload = JSON.parse(text(formData, "draft"));
  } catch {
    return refused(UNREADABLE);
  }

  const page = await getWebsitePage(documentId);
  if (!page.ok) return refused(page.error);

  const parsed = websiteDraftSchema(page.data.kind).safeParse(payload);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join(".") || "form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return refused("Check the highlighted fields.", { fieldErrors });
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
      const fresh = await getWebsitePage(documentId);
      return refused(STALE_EDIT_MESSAGE, {
        stale: {
          latestRevisionNumber: fresh.ok
            ? fresh.data.latestRevisionNumber
            : draft.baseRevisionNumber,
        },
      });
    }
    return refused(result.error);
  }

  revalidatePage(documentId);
  return {
    message: `Draft saved as version ${result.data.revisionNumber}. It is not public until you publish it.`,
    saved: result.data,
  };
}

export async function publishWebsitePageAction(
  _prev: WebsiteActionState,
  formData: FormData,
): Promise<WebsiteActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);

  const documentId = text(formData, "documentId");
  const revisionId = text(formData, "revisionId");
  if (!isUuid(documentId) || !isUuid(revisionId)) return refused(UNREADABLE);

  const page = await getWebsitePage(documentId);
  if (!page.ok) return refused(page.error);

  // C4: refused before any database call. Not yet enforced by the database.
  if (isPublicationHeld(page.data)) return refused(LEGAL_PUBLICATION_HELD_MESSAGE);

  const result = await publishWebsitePage(documentId, revisionId);
  if (!result.ok) {
    return refused(
      result.error,
      result.kind === "stale"
        ? { stale: { latestRevisionNumber: page.data.latestRevisionNumber } }
        : {},
    );
  }

  revalidatePage(documentId);
  return { message: "Published. This version is now the live content for this page." };
}

export async function unpublishWebsitePageAction(
  _prev: WebsiteActionState,
  formData: FormData,
): Promise<WebsiteActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);

  const documentId = text(formData, "documentId");
  const expectedVersion = wholeNumber(formData, "expectedVersion");
  if (!isUuid(documentId) || expectedVersion === null) return refused(UNREADABLE);

  const result = await unpublishWebsitePage(documentId, expectedVersion);
  if (!result.ok) return refused(result.error);

  revalidatePage(documentId);
  return {
    message:
      "Unpublished. The page has no live content now; its drafts and history are kept.",
  };
}

export async function restoreWebsiteRevisionAction(
  _prev: WebsiteActionState,
  formData: FormData,
): Promise<WebsiteActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);

  const documentId = text(formData, "documentId");
  const sourceRevisionId = text(formData, "sourceRevisionId");
  const baseRevisionNumber = wholeNumber(formData, "baseRevisionNumber");
  if (!isUuid(documentId) || !isUuid(sourceRevisionId) || baseRevisionNumber === null) {
    return refused(UNREADABLE);
  }

  const result = await restoreWebsiteRevision(
    documentId,
    sourceRevisionId,
    baseRevisionNumber,
  );
  if (!result.ok) return refused(result.error);

  revalidatePage(documentId);
  redirect(`/admin/website/pages/${documentId}?restored=${result.data.revisionNumber}`);
}
