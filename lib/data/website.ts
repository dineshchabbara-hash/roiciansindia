import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import { websiteErrorKind, type WebsiteErrorKind } from "@/lib/domain/website";
import {
  ITEM_FIELDS,
  isAdminPageKind,
  websiteActionMessage,
  websitePageStatus,
  type AdminPageKind,
  type EditableSection,
  type ItemField,
  type WebsitePageStatus,
} from "@/lib/domain/website-admin";

/**
 * Phase 22B-1: Admin Website Management data access (PHASE_22B_PLAN.md §4.2).
 *
 * Every read and write runs through the caller's OWN session: reads through the
 * Admin/Super Admin RLS read policies on the website tables, writes only through
 * the Phase 22A database functions (website_create_page, website_save_draft,
 * website_publish_document, website_unpublish_document, website_restore_revision).
 * The service-role key is never used here. Those functions re-check that the
 * caller is an ACTIVE Admin or Super Admin, enforce the stale-edit guard and
 * every content rule, and write the audit log themselves, so this layer adds no
 * audit rows of its own.
 *
 * Program pages (kind = 'program') are managed in 22B-2 (lib/data/website-programs.ts)
 * and are excluded from the page functions here. The version-history readers
 * take a scope, so 22B-2 reuses them for Program documents.
 */

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Which documents a reader accepts: website pages (22B-1) or Programs (22B-2). */
export type DocumentScope = "page" | "program";

function inScope(kind: string, scope: DocumentScope): boolean {
  return scope === "program" ? kind === "program" : isAdminPageKind(kind);
}

export type WriteResult<T> =
  { ok: true; data: T } | { ok: false; error: string; kind: WebsiteErrorKind };

export type WebsitePageSummary = {
  id: string;
  kind: AdminPageKind;
  pageKey: string;
  /** Title of the latest saved version, if any. */
  title: string | null;
  status: WebsitePageStatus;
  latestRevisionId: string | null;
  latestRevisionNumber: number;
  publishedRevisionId: string | null;
  /** Document version, for unpublish (optimistic concurrency). */
  version: number;
  updatedAt: string;
  updatedByName: string | null;
  publishedAt: string | null;
  publishedByName: string | null;
  firstPublishedAt: string | null;
  unpublishedAt: string | null;
};

export type WebsiteRevisionContent = {
  id: string;
  number: number;
  title: string;
  summary: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  socialTitle: string | null;
  socialDescription: string | null;
  heroImageAssetId: string | null;
  socialImageAssetId: string | null;
  sections: EditableSection[];
  createdAt: string;
  createdByName: string | null;
  restoredFromRevisionId: string | null;
};

export type WebsitePageDetail = WebsitePageSummary & {
  latest: WebsiteRevisionContent | null;
  publishedRevisionNumber: number | null;
};

export type WebsiteRevisionSummary = {
  id: string;
  number: number;
  title: string;
  createdAt: string;
  createdByName: string | null;
  restoredFromNumber: number | null;
  isLatest: boolean;
  isPublished: boolean;
};

const DOCUMENT_COLUMNS =
  "id, kind, page_key, latest_revision_id, latest_revision_number, published_revision_id, published_at, published_by, first_published_at, unpublished_at, version, updated_at, updated_by";

export const REVISION_COLUMNS =
  "id, document_id, revision_number, title, summary, seo_title, seo_description, social_title, social_description, hero_image_asset_id, social_image_asset_id, sections, restored_from_revision_id, created_at, created_by";

type DocumentRow = {
  id: string;
  kind: string;
  page_key: string;
  latest_revision_id: string | null;
  latest_revision_number: number;
  published_revision_id: string | null;
  published_at: string | null;
  published_by: string | null;
  first_published_at: string | null;
  unpublished_at: string | null;
  version: number;
  updated_at: string;
  updated_by: string | null;
};

export type RevisionRow = {
  id: string;
  document_id: string;
  revision_number: number;
  title: string;
  summary: string | null;
  seo_title: string | null;
  seo_description: string | null;
  social_title: string | null;
  social_description: string | null;
  hero_image_asset_id: string | null;
  social_image_asset_id: string | null;
  sections: unknown;
  restored_from_revision_id: string | null;
  created_at: string;
  created_by: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Returned for an unknown, malformed or Program page id; pages show a 404 for it. */
export const WEBSITE_NOT_FOUND = "This page could not be found.";
const NOT_FOUND = WEBSITE_NOT_FOUND;

function log(message: string, error?: unknown) {
  console.error(`[website] ${message}:`, error);
}

/** Admin names for the people who edited or published (through the caller's session). */
export async function adminNames(
  client: Client,
  ids: Array<string | null>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const { data } = await client
    .from("admins")
    .select("auth_user_id, first_name, last_name")
    .in("auth_user_id", unique);
  for (const row of (data ?? []) as Array<{
    auth_user_id: string | null;
    first_name: string;
    last_name: string;
  }>) {
    if (row.auth_user_id) {
      names.set(row.auth_user_id, `${row.first_name} ${row.last_name}`.trim());
    }
  }
  return names;
}

function toSummary(
  row: DocumentRow,
  title: string | null,
  names: Map<string, string>,
): WebsitePageSummary {
  return {
    id: row.id,
    kind: row.kind as AdminPageKind,
    pageKey: row.page_key,
    title,
    status: websitePageStatus({
      latestRevisionId: row.latest_revision_id,
      publishedRevisionId: row.published_revision_id,
      firstPublishedAt: row.first_published_at,
    }),
    latestRevisionId: row.latest_revision_id,
    latestRevisionNumber: row.latest_revision_number,
    publishedRevisionId: row.published_revision_id,
    version: row.version,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by ? (names.get(row.updated_by) ?? null) : null,
    publishedAt: row.published_at,
    publishedByName: row.published_by ? (names.get(row.published_by) ?? null) : null,
    firstPublishedAt: row.first_published_at,
    unpublishedAt: row.unpublished_at,
  };
}

const asText = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * Stored sections (already validated by the database) into the editor's shape.
 * Anything unexpected is dropped rather than trusted.
 */
export function parseStoredSections(value: unknown): EditableSection[] {
  if (!Array.isArray(value)) return [];
  const sections: EditableSection[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const key = asText(s.key);
    const type = asText(s.type);
    if (!key || !type) continue;
    const section: EditableSection = {
      key,
      type,
      visible: s.visible !== false,
    };
    const heading = asText(s.heading);
    if (heading !== undefined) section.heading = heading;
    const body = asText(s.body);
    if (body !== undefined) section.body = body;
    const imageAssetId = asText(s.imageAssetId);
    if (imageAssetId !== undefined) section.imageAssetId = imageAssetId;
    if (s.cta && typeof s.cta === "object") {
      const cta = s.cta as Record<string, unknown>;
      section.cta = { label: asText(cta.label) ?? "", href: asText(cta.href) ?? "" };
    }
    if (Array.isArray(s.items)) {
      section.items = s.items
        .filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === "object")
        .map((i) => {
          const item: Partial<Record<ItemField, string>> = {};
          for (const field of ITEM_FIELDS) {
            const v = asText(i[field]);
            if (v !== undefined) item[field] = v;
          }
          return item;
        });
    }
    sections.push(section);
  }
  return sections;
}

export function toContent(
  row: RevisionRow,
  names: Map<string, string>,
): WebsiteRevisionContent {
  return {
    id: row.id,
    number: row.revision_number,
    title: row.title,
    summary: row.summary,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    socialTitle: row.social_title,
    socialDescription: row.social_description,
    heroImageAssetId: row.hero_image_asset_id,
    socialImageAssetId: row.social_image_asset_id,
    sections: parseStoredSections(row.sections),
    createdAt: row.created_at,
    createdByName: row.created_by ? (names.get(row.created_by) ?? null) : null,
    restoredFromRevisionId: row.restored_from_revision_id,
  };
}

// ---------------------------------------------------------------------------
// Reads

/** Every non-Program website page, for the dashboard. */
export async function listWebsitePages(): Promise<DataResult<WebsitePageSummary[]>> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from("website_documents")
      .select(DOCUMENT_COLUMNS)
      .neq("kind", "program")
      .order("created_at", { ascending: true });
    if (error) throw error;
    const rows = ((data ?? []) as DocumentRow[]).filter((r) => isAdminPageKind(r.kind));

    const latestIds = rows
      .map((r) => r.latest_revision_id)
      .filter((id): id is string => Boolean(id));
    const titles = new Map<string, string>();
    if (latestIds.length > 0) {
      const { data: revisions, error: revError } = await client
        .from("website_document_revisions")
        .select("id, title")
        .in("id", latestIds);
      if (revError) throw revError;
      for (const r of (revisions ?? []) as Array<{ id: string; title: string }>) {
        titles.set(r.id, r.title);
      }
    }
    const names = await adminNames(
      client,
      rows.flatMap((r) => [r.updated_by, r.published_by]),
    );
    return {
      ok: true,
      data: rows.map((r) =>
        toSummary(
          r,
          r.latest_revision_id ? (titles.get(r.latest_revision_id) ?? null) : null,
          names,
        ),
      ),
    };
  } catch (error) {
    log("Could not load website pages", error);
    return { ok: false, error: "Could not load website pages." };
  }
}

async function loadDocument(
  client: Client,
  id: string,
  scope: DocumentScope = "page",
): Promise<DocumentRow | null> {
  const { data, error } = await client
    .from("website_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const row = data as DocumentRow | null;
  if (!row || !inScope(row.kind, scope)) return null;
  return row;
}

/** One page with its latest saved version, for the editor and preview. */
export async function getWebsitePage(id: string): Promise<DataResult<WebsitePageDetail>> {
  if (!isUuid(id)) return { ok: false, error: NOT_FOUND };
  try {
    const client = await createSupabaseServerClient();
    const doc = await loadDocument(client, id);
    if (!doc) return { ok: false, error: NOT_FOUND };

    const wanted = [doc.latest_revision_id, doc.published_revision_id].filter(
      (r): r is string => Boolean(r),
    );
    let latestRow: RevisionRow | null = null;
    let publishedNumber: number | null = null;
    if (wanted.length > 0) {
      const { data, error } = await client
        .from("website_document_revisions")
        .select(REVISION_COLUMNS)
        .eq("document_id", doc.id)
        .in("id", wanted);
      if (error) throw error;
      for (const r of (data ?? []) as RevisionRow[]) {
        if (r.id === doc.latest_revision_id) latestRow = r;
        if (r.id === doc.published_revision_id) publishedNumber = r.revision_number;
      }
    }
    const names = await adminNames(client, [
      doc.updated_by,
      doc.published_by,
      latestRow?.created_by ?? null,
    ]);
    return {
      ok: true,
      data: {
        ...toSummary(doc, latestRow?.title ?? null, names),
        latest: latestRow ? toContent(latestRow, names) : null,
        publishedRevisionNumber: publishedNumber,
      },
    };
  } catch (error) {
    log("Could not load a website page", error);
    return { ok: false, error: "Could not load this page." };
  }
}

/** Every saved version of a page (or, with scope "program", a Program), newest first. */
export async function listWebsiteRevisions(
  documentId: string,
  scope: DocumentScope = "page",
): Promise<DataResult<WebsiteRevisionSummary[]>> {
  if (!isUuid(documentId)) return { ok: false, error: NOT_FOUND };
  try {
    const client = await createSupabaseServerClient();
    const doc = await loadDocument(client, documentId, scope);
    if (!doc) return { ok: false, error: NOT_FOUND };
    const { data, error } = await client
      .from("website_document_revisions")
      .select(
        "id, revision_number, title, created_at, created_by, restored_from_revision_id",
      )
      .eq("document_id", documentId)
      .order("revision_number", { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      id: string;
      revision_number: number;
      title: string;
      created_at: string;
      created_by: string | null;
      restored_from_revision_id: string | null;
    }>;
    const numbers = new Map(rows.map((r) => [r.id, r.revision_number]));
    const names = await adminNames(
      client,
      rows.map((r) => r.created_by),
    );
    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        number: r.revision_number,
        title: r.title,
        createdAt: r.created_at,
        createdByName: r.created_by ? (names.get(r.created_by) ?? null) : null,
        restoredFromNumber: r.restored_from_revision_id
          ? (numbers.get(r.restored_from_revision_id) ?? null)
          : null,
        isLatest: r.id === doc.latest_revision_id,
        isPublished: r.id === doc.published_revision_id,
      })),
    };
  } catch (error) {
    log("Could not load website page history", error);
    return { ok: false, error: "Could not load the page history." };
  }
}

/** One saved version of a page or Program (it must belong to that document). */
export async function getWebsiteRevision(
  documentId: string,
  revisionId: string,
  scope: DocumentScope = "page",
): Promise<DataResult<WebsiteRevisionContent>> {
  if (!isUuid(documentId) || !isUuid(revisionId)) return { ok: false, error: NOT_FOUND };
  try {
    const client = await createSupabaseServerClient();
    const doc = await loadDocument(client, documentId, scope);
    if (!doc) return { ok: false, error: NOT_FOUND };
    const { data, error } = await client
      .from("website_document_revisions")
      .select(REVISION_COLUMNS)
      .eq("document_id", documentId)
      .eq("id", revisionId)
      .maybeSingle();
    if (error) throw error;
    const row = data as RevisionRow | null;
    if (!row) return { ok: false, error: NOT_FOUND };
    const names = await adminNames(client, [row.created_by]);
    return { ok: true, data: toContent(row, names) };
  } catch (error) {
    log("Could not load a website page version", error);
    return { ok: false, error: "Could not load this version." };
  }
}

// ---------------------------------------------------------------------------
// Writes (Phase 22A database functions only)

function failure<T>(error: { code?: string; message?: string }): WriteResult<T> {
  const kind = websiteErrorKind(error.code);
  if (kind === "unknown") throw error;
  return { ok: false, kind, error: websiteActionMessage(kind, error.message) };
}

function unexpected<T>(what: string, error: unknown): WriteResult<T> {
  log(what, error);
  return { ok: false, kind: "unknown", error: websiteActionMessage("unknown") };
}

export async function createWebsitePage(
  kind: AdminPageKind,
  pageKey: string,
): Promise<WriteResult<{ id: string }>> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("website_create_page", {
      p_kind: kind,
      p_page_key: pageKey,
    });
    if (error) return failure(error);
    if (typeof data !== "string") throw new Error("website_create_page returned no id");
    return { ok: true, data: { id: data } };
  } catch (error) {
    return unexpected("Could not create a website page", error);
  }
}

export type DraftInput = {
  documentId: string;
  baseRevisionNumber: number;
  title: string;
  summary: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  socialTitle: string | null;
  socialDescription: string | null;
  heroImageAssetId: string | null;
  socialImageAssetId: string | null;
  sections: unknown[];
};

export type SavedRevision = { revisionId: string; revisionNumber: number };

export async function saveWebsiteDraft(
  input: DraftInput,
): Promise<WriteResult<SavedRevision>> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("website_save_draft", {
      p_document_id: input.documentId,
      p_base_revision_number: input.baseRevisionNumber,
      p_title: input.title,
      p_summary: input.summary,
      p_seo_title: input.seoTitle,
      p_seo_description: input.seoDescription,
      p_social_title: input.socialTitle,
      p_social_description: input.socialDescription,
      p_hero_image_asset_id: input.heroImageAssetId,
      p_social_image_asset_id: input.socialImageAssetId,
      p_sections: input.sections,
    });
    if (error) return failure(error);
    const row = (
      data as Array<{ revision_id: string; revision_number: number }> | null
    )?.[0];
    if (!row) throw new Error("website_save_draft returned no row");
    return {
      ok: true,
      data: { revisionId: row.revision_id, revisionNumber: row.revision_number },
    };
  } catch (error) {
    return unexpected("Could not save a website draft", error);
  }
}

export async function publishWebsitePage(
  documentId: string,
  revisionId: string,
): Promise<WriteResult<null>> {
  try {
    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("website_publish_document", {
      p_document_id: documentId,
      p_revision_id: revisionId,
    });
    if (error) return failure(error);
    return { ok: true, data: null };
  } catch (error) {
    return unexpected("Could not publish a website page", error);
  }
}

export async function unpublishWebsitePage(
  documentId: string,
  expectedVersion: number,
): Promise<WriteResult<{ version: number }>> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("website_unpublish_document", {
      p_document_id: documentId,
      p_expected_version: expectedVersion,
    });
    if (error) return failure(error);
    return { ok: true, data: { version: Number(data) } };
  } catch (error) {
    return unexpected("Could not unpublish a website page", error);
  }
}

export async function restoreWebsiteRevision(
  documentId: string,
  sourceRevisionId: string,
  baseRevisionNumber: number,
): Promise<WriteResult<SavedRevision>> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("website_restore_revision", {
      p_document_id: documentId,
      p_source_revision_id: sourceRevisionId,
      p_base_revision_number: baseRevisionNumber,
    });
    if (error) return failure(error);
    const row = (
      data as Array<{ revision_id: string; revision_number: number }> | null
    )?.[0];
    if (!row) throw new Error("website_restore_revision returned no row");
    return {
      ok: true,
      data: { revisionId: row.revision_id, revisionNumber: row.revision_number },
    };
  } catch (error) {
    return unexpected("Could not restore a website page version", error);
  }
}
