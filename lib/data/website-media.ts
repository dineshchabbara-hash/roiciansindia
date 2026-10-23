import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import { adminNames, isUuid, type WriteResult } from "@/lib/data/website";
import { websiteErrorKind } from "@/lib/domain/website";
import { isAdminPageKind, pageDisplayName } from "@/lib/domain/website-admin";
import {
  MEDIA_PREVIEW_SECONDS,
  UPLOADS_NOT_ENABLED_MESSAGE,
  contentImageIds,
  isMediaMimeType,
  isMediaStatus,
  mediaFileName,
  mediaMessage,
  type MediaMimeType,
  type MediaStatus,
} from "@/lib/domain/website-media";

/**
 * Phase 22B-3: website media data access.
 *
 * Every read and write runs through the signed-in Admin's OWN session (no
 * service-role key). Reads use the Phase 22A Admin/Super Admin read policies
 * on website_media_assets and the private website-media bucket. Writes go
 * only through the Phase 22A database functions (which check the active
 * Admin role, versions and content rules, and write the audit log) and
 * through Storage, whose policies are in the reviewed upload proposal.
 *
 * Images are shown to Admins through short-lived signed links created with
 * the Admin's own session. No public URL is ever created.
 */

export const MEDIA_BUCKET = "website-media";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export const MEDIA_NOT_FOUND = "This image could not be found.";

export type MediaAsset = {
  id: string;
  path: string;
  fileName: string;
  mimeType: MediaMimeType;
  byteSize: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  status: MediaStatus;
  version: number;
  createdAt: string;
  createdByName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  updatedAt: string;
  /** A signed link valid for a few minutes, or null if it could not be made. */
  previewUrl: string | null;
};

/** What the editor and preview need to show a chosen image. */
export type MediaOption = Pick<
  MediaAsset,
  "id" | "fileName" | "altText" | "status" | "width" | "height" | "previewUrl"
>;

/** What the editor knows about images: approved choices and the chosen ones. */
export type EditorMedia = {
  /** Approved images that may be chosen. */
  approved: MediaOption[];
  /** Images the content already uses, whatever their status. */
  chosen: Record<string, MediaOption>;
};

export type MediaUsage = {
  documentId: string;
  label: string;
  href: string;
  /** The live (published) version uses this image. */
  inPublished: boolean;
  /** The latest saved version uses this image. */
  inLatest: boolean;
  versionNumbers: number[];
};

export type IncompleteUpload = {
  path: string;
  uploadedAt: string;
  byteSize: number | null;
  uploadedByMe: boolean;
};

const MEDIA_COLUMNS =
  "id, storage_path, mime_type, byte_size, width, height, alt_text, status, approved_at, approved_by, version, created_at, created_by, updated_at";

type MediaRow = {
  id: string;
  storage_path: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  status: string;
  approved_at: string | null;
  approved_by: string | null;
  version: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
};

function log(message: string, error?: unknown) {
  console.error(`[website-media] ${message}:`, error);
}

async function previewUrls(
  client: Client,
  paths: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  const { data, error } = await client.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(paths, MEDIA_PREVIEW_SECONDS);
  if (error) {
    log("Could not create preview links", error);
    return urls;
  }
  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

async function toAssets(client: Client, rows: MediaRow[]): Promise<MediaAsset[]> {
  const [names, urls] = await Promise.all([
    adminNames(
      client,
      rows.flatMap((r) => [r.created_by, r.approved_by]),
    ),
    previewUrls(
      client,
      rows.map((r) => r.storage_path),
    ),
  ]);
  return rows
    .filter((r) => isMediaMimeType(r.mime_type) && isMediaStatus(r.status))
    .map((r) => ({
      id: r.id,
      path: r.storage_path,
      fileName: mediaFileName(r.storage_path),
      mimeType: r.mime_type as MediaMimeType,
      byteSize: r.byte_size,
      width: r.width,
      height: r.height,
      altText: r.alt_text,
      status: r.status as MediaStatus,
      version: r.version,
      createdAt: r.created_at,
      createdByName: r.created_by ? (names.get(r.created_by) ?? null) : null,
      approvedAt: r.approved_at,
      approvedByName: r.approved_by ? (names.get(r.approved_by) ?? null) : null,
      updatedAt: r.updated_at,
      previewUrl: urls.get(r.storage_path) ?? null,
    }));
}

export function toOption(asset: MediaAsset): MediaOption {
  return {
    id: asset.id,
    fileName: asset.fileName,
    altText: asset.altText,
    status: asset.status,
    width: asset.width,
    height: asset.height,
    previewUrl: asset.previewUrl,
  };
}

// ---------------------------------------------------------------------------
// Reads

/** The media library, newest first, optionally by status. */
export async function listMediaAssets(
  status: MediaStatus | "all" = "all",
): Promise<DataResult<MediaAsset[]>> {
  try {
    const client = await createSupabaseServerClient();
    let query = client.from("website_media_assets").select(MEDIA_COLUMNS);
    if (status !== "all") query = query.eq("status", status);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    return { ok: true, data: await toAssets(client, (data ?? []) as MediaRow[]) };
  } catch (error) {
    log("Could not load the media library", error);
    return { ok: false, error: "Could not load the media library." };
  }
}

/** Approved images, for choosing images in content. */
export async function listApprovedMedia(): Promise<DataResult<MediaOption[]>> {
  const result = await listMediaAssets("approved");
  return result.ok ? { ok: true, data: result.data.map(toOption) } : result;
}

/** The chosen images of a draft, whatever their status (for warnings and preview). */
export async function getMediaOptions(
  ids: readonly string[],
): Promise<DataResult<Record<string, MediaOption>>> {
  const wanted = [...new Set(ids.filter(isUuid))];
  if (wanted.length === 0) return { ok: true, data: {} };
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from("website_media_assets")
      .select(MEDIA_COLUMNS)
      .in("id", wanted);
    if (error) throw error;
    const assets = await toAssets(client, (data ?? []) as MediaRow[]);
    return { ok: true, data: Object.fromEntries(assets.map((a) => [a.id, toOption(a)])) };
  } catch (error) {
    log("Could not load chosen images", error);
    return { ok: false, error: "Could not load the chosen images." };
  }
}

/**
 * Everything the editor needs for images: Approved choices plus the images
 * the content already uses. Null if it cannot be loaded (the editor then
 * keeps images unchanged, as before 22B-3).
 */
export async function getEditorMedia(
  content: {
    heroImageAssetId: string | null;
    socialImageAssetId: string | null;
    sections: ReadonlyArray<{ imageAssetId?: string }>;
  } | null,
): Promise<EditorMedia | null> {
  const ids = content ? contentImageIds(content) : [];
  const [approved, chosen] = await Promise.all([
    listApprovedMedia(),
    getMediaOptions(ids),
  ]);
  if (!approved.ok || !chosen.ok) return null;
  return { approved: approved.data, chosen: chosen.data };
}

export type MediaDetail = { asset: MediaAsset; usage: MediaUsage[] };

/** One image with where it is used. */
export async function getMediaAsset(id: string): Promise<DataResult<MediaDetail>> {
  if (!isUuid(id)) return { ok: false, error: MEDIA_NOT_FOUND };
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from("website_media_assets")
      .select(MEDIA_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: MEDIA_NOT_FOUND };
    const [asset] = await toAssets(client, [data as MediaRow]);
    if (!asset) return { ok: false, error: MEDIA_NOT_FOUND };
    return { ok: true, data: { asset, usage: await mediaUsage(client, id) } };
  } catch (error) {
    log("Could not load an image", error);
    return { ok: false, error: "Could not load this image." };
  }
}

async function mediaUsage(client: Client, assetId: string): Promise<MediaUsage[]> {
  const { data: uses, error: usesError } = await client
    .from("website_revision_media")
    .select("revision_id")
    .eq("asset_id", assetId);
  if (usesError) throw usesError;
  const revisionIds = ((uses ?? []) as Array<{ revision_id: string }>).map(
    (u) => u.revision_id,
  );
  if (revisionIds.length === 0) return [];

  const { data: revisions, error: revError } = await client
    .from("website_document_revisions")
    .select("id, document_id, revision_number")
    .in("id", revisionIds);
  if (revError) throw revError;
  const revRows = (revisions ?? []) as Array<{
    id: string;
    document_id: string;
    revision_number: number;
  }>;
  const docIds = [...new Set(revRows.map((r) => r.document_id))];
  const { data: docs, error: docError } = await client
    .from("website_documents")
    .select("id, kind, page_key, program_id, latest_revision_id, published_revision_id")
    .in("id", docIds);
  if (docError) throw docError;
  const docRows = (docs ?? []) as Array<{
    id: string;
    kind: string;
    page_key: string | null;
    program_id: string | null;
    latest_revision_id: string | null;
    published_revision_id: string | null;
  }>;
  const programIds = docRows.flatMap((d) => (d.program_id ? [d.program_id] : []));
  const programNames = new Map<string, string>();
  if (programIds.length > 0) {
    const { data: programs } = await client
      .from("programs")
      .select("id, name")
      .in("id", programIds);
    for (const p of (programs ?? []) as Array<{ id: string; name: string }>) {
      programNames.set(p.id, p.name);
    }
  }

  return docRows
    .map((d) => {
      const own = revRows.filter((r) => r.document_id === d.id);
      const isProgram = d.kind === "program";
      const label = isProgram
        ? `Program: ${(d.program_id && programNames.get(d.program_id)) || "Program"}`
        : isAdminPageKind(d.kind)
          ? pageDisplayName({ kind: d.kind, pageKey: d.page_key ?? "" })
          : d.kind;
      return {
        documentId: d.id,
        label,
        href: isProgram
          ? `/admin/website/programs/${d.id}`
          : `/admin/website/pages/${d.id}`,
        inPublished: own.some((r) => r.id === d.published_revision_id),
        inLatest: own.some((r) => r.id === d.latest_revision_id),
        versionNumbers: own.map((r) => r.revision_number).sort((a, b) => a - b),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Unrecorded uploads older than 24 hours. Before the upload proposal is
 * applied the database function does not exist; the screen then says the
 * clean-up is not available yet.
 */
export async function listIncompleteUploads(): Promise<
  DataResult<{ available: boolean; items: IncompleteUpload[] }>
> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("website_incomplete_media_uploads" as never);
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") {
        return { ok: true, data: { available: false, items: [] } };
      }
      throw error;
    }
    const rows = (data ?? []) as Array<{
      storage_path: string;
      uploaded_at: string;
      byte_size: number | null;
      uploaded_by_me: boolean;
    }>;
    return {
      ok: true,
      data: {
        available: true,
        items: rows.map((r) => ({
          path: r.storage_path,
          uploadedAt: r.uploaded_at,
          byteSize: r.byte_size,
          uploadedByMe: r.uploaded_by_me,
        })),
      },
    };
  } catch (error) {
    log("Could not list incomplete uploads", error);
    return { ok: false, error: "Could not check for incomplete uploads." };
  }
}

// ---------------------------------------------------------------------------
// Storage (the reviewed upload proposal must be applied for these to work)

function isPolicyRefusal(
  error: { message?: string; statusCode?: string | number } | null,
) {
  if (!error) return false;
  const status = String(error.statusCode ?? "");
  return (
    status === "403" ||
    status === "401" ||
    /row-level security|unauthori[sz]ed|not allowed/i.test(error.message ?? "")
  );
}

/** A one-time signed upload link for exactly this new path (no overwrite). */
export async function createMediaUploadUrl(
  path: string,
): Promise<WriteResult<{ signedUrl: string; token: string }>> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.storage
      .from(MEDIA_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      if (isPolicyRefusal(error as { message?: string; statusCode?: string })) {
        return { ok: false, kind: "not_allowed", error: UPLOADS_NOT_ENABLED_MESSAGE };
      }
      throw error ?? new Error("No upload link returned");
    }
    return { ok: true, data: { signedUrl: data.signedUrl, token: data.token } };
  } catch (error) {
    log("Could not create an upload link", error);
    return {
      ok: false,
      kind: "unknown",
      error: "Could not start the upload. Please try again.",
    };
  }
}

/** Reads an uploaded file back (to check its actual bytes). */
export async function readStoredMedia(
  path: string,
): Promise<{ ok: true; data: Uint8Array } | { ok: false; missing: boolean }> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.storage.from(MEDIA_BUCKET).download(path);
    if (error || !data) {
      const status = String((error as { statusCode?: string } | null)?.statusCode ?? "");
      return { ok: false, missing: status === "404" || status === "400" };
    }
    return { ok: true, data: new Uint8Array(await data.arrayBuffer()) };
  } catch (error) {
    log("Could not read an uploaded file", error);
    return { ok: false, missing: false };
  }
}

/** Removes unrecorded uploads (Storage policy: never a recorded image). */
export async function removeStoredMedia(paths: string[]): Promise<number> {
  if (paths.length === 0) return 0;
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.storage.from(MEDIA_BUCKET).remove(paths);
    if (error) {
      log("Could not remove uploaded files", error);
      return 0;
    }
    return (data ?? []).length;
  } catch (error) {
    log("Could not remove uploaded files", error);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Database writes (Phase 22A functions)

function failure<T>(error: { code?: string; message?: string }): WriteResult<T> {
  const kind = websiteErrorKind(error.code);
  if (kind === "unknown") throw error;
  return { ok: false, kind, error: mediaMessage(kind, error.message) };
}

function unexpected<T>(what: string, error: unknown): WriteResult<T> {
  log(what, error);
  return { ok: false, kind: "unknown", error: mediaMessage("unknown") };
}

export async function registerMediaAsset(input: {
  path: string;
  mimeType: MediaMimeType;
  byteSize: number;
  width: number;
  height: number;
  altText: string | null;
}): Promise<WriteResult<{ id: string }>> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("website_register_media_asset", {
      p_storage_path: input.path,
      p_mime_type: input.mimeType,
      p_byte_size: input.byteSize,
      p_width: input.width,
      p_height: input.height,
      p_alt_text: input.altText,
    } as never);
    if (error) return failure(error);
    if (typeof data !== "string")
      throw new Error("website_register_media_asset returned no id");
    return { ok: true, data: { id: data } };
  } catch (error) {
    return unexpected("Could not record an uploaded image", error);
  }
}

export async function updateMediaAsset(
  id: string,
  expectedVersion: number,
  altText: string | null,
  status: MediaStatus,
): Promise<WriteResult<{ version: number }>> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("website_update_media_asset", {
      p_asset_id: id,
      p_expected_version: expectedVersion,
      p_alt_text: altText,
      p_status: status,
    } as never);
    if (error) return failure(error);
    return { ok: true, data: { version: Number(data) } };
  } catch (error) {
    return unexpected("Could not update an image", error);
  }
}
