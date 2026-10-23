"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import { isUuid } from "@/lib/data/website";
import {
  createMediaUploadUrl,
  getMediaAsset,
  listIncompleteUploads,
  readStoredMedia,
  registerMediaAsset,
  removeStoredMedia,
  updateMediaAsset,
} from "@/lib/data/website-media";
import {
  MEDIA_MAX_BYTES,
  MEDIA_STATUS_CHANGES,
  altTextProblem,
  buildMediaPath,
  inspectImage,
  isMediaMimeType,
  isMediaPath,
  isMediaStatusChange,
  mediaPathType,
} from "@/lib/domain/website-media";

/**
 * Phase 22B-3: website media actions. Admin and Super Admin only: checked
 * here from the session first, then again by the database functions and the
 * Storage policies (which also refuse an inactive Admin). Every change names
 * the version the Admin was looking at, so a concurrent change is refused.
 */

export type MediaActionState = {
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  attempt?: number;
  version?: number;
};

export type PrepareUploadResult =
  { ok: true; path: string; token: string } | { ok: false; error: string };

export type CompleteUploadResult =
  { ok: true; id: string } | { ok: false; error: string };

const NOT_AUTHORIZED = "Only an Admin or Super Admin can manage website media.";
const UNREADABLE = "This request could not be read. Reload the page and try again.";
const STALE =
  "Someone else changed this image after you opened it. Reload to see the latest details, then try again.";

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
  return /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}

function refused(error: string, extra: Partial<MediaActionState> = {}): MediaActionState {
  return { error, attempt: Date.now(), ...extra };
}

function revalidateMedia(assetId?: string) {
  revalidatePath("/admin/website/media");
  if (assetId) revalidatePath(`/admin/website/media/${assetId}`);
  // Editors and previews show image status and warnings.
  revalidatePath("/admin/website", "layout");
}

// ---------------------------------------------------------------------------
// Upload (two steps around a direct browser-to-Storage upload)

/**
 * Step 1: a one-time signed upload link for a new, unique path. The browser
 * then sends the file straight to the private bucket, so the file never
 * passes through the application server.
 */
export async function prepareMediaUploadAction(input: {
  fileName: unknown;
  byteSize: unknown;
  mimeType: unknown;
  altText: unknown;
}): Promise<PrepareUploadResult> {
  if (!(await authorized())) return { ok: false, error: NOT_AUTHORIZED };
  const { fileName, byteSize, mimeType, altText } = input ?? {};
  if (typeof fileName !== "string" || fileName.length === 0 || fileName.length > 255) {
    return { ok: false, error: UNREADABLE };
  }
  if (!isMediaMimeType(mimeType)) {
    return { ok: false, error: "Only JPEG, PNG and WebP images can be uploaded." };
  }
  if (typeof byteSize !== "number" || !Number.isInteger(byteSize) || byteSize < 1) {
    return { ok: false, error: UNREADABLE };
  }
  if (byteSize > MEDIA_MAX_BYTES) {
    return { ok: false, error: "The file is larger than 5 MB. Use a smaller image." };
  }
  if (typeof altText !== "string") return { ok: false, error: UNREADABLE };
  if (altText.trim() !== "") {
    const problem = altTextProblem(altText);
    if (problem) return { ok: false, error: problem };
  }

  const path = buildMediaPath(crypto.randomUUID(), fileName, mimeType);
  const link = await createMediaUploadUrl(path);
  if (!link.ok) return { ok: false, error: link.error };
  return { ok: true, path, token: link.data.token };
}

/**
 * Step 2: checks the stored file's ACTUAL bytes, then records it as a Draft
 * image. On any failure the uploaded file is removed again (the Storage
 * policy lets the uploader remove their own unrecorded file).
 */
export async function completeMediaUploadAction(input: {
  path: unknown;
  altText: unknown;
}): Promise<CompleteUploadResult> {
  if (!(await authorized())) return { ok: false, error: NOT_AUTHORIZED };
  const { path, altText } = input ?? {};
  if (!isMediaPath(path) || typeof altText !== "string") {
    return { ok: false, error: UNREADABLE };
  }
  const alt = altText.trim();

  const discard = async (error: string): Promise<CompleteUploadResult> => {
    await removeStoredMedia([path]);
    return { ok: false, error };
  };

  if (alt !== "") {
    const problem = altTextProblem(alt);
    if (problem) return discard(problem);
  }

  const stored = await readStoredMedia(path);
  if (!stored.ok) {
    return stored.missing
      ? { ok: false, error: "The upload did not arrive. Please try again." }
      : discard("Could not check the uploaded file. Please try again.");
  }
  const check = inspectImage(stored.data);
  if (!check.ok) return discard(check.reason);
  if (check.info.type !== mediaPathType(path)) {
    return discard(
      "The uploaded file is not the image that was prepared. Please try again.",
    );
  }

  const result = await registerMediaAsset({
    path,
    mimeType: check.info.type,
    byteSize: stored.data.length,
    width: check.info.width,
    height: check.info.height,
    altText: alt === "" ? null : alt,
  });
  if (!result.ok) return discard(result.error);
  revalidateMedia(result.data.id);
  return { ok: true, id: result.data.id };
}

// ---------------------------------------------------------------------------
// Alt text and status

export async function saveMediaAltTextAction(
  _prev: MediaActionState,
  formData: FormData,
): Promise<MediaActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const assetId = text(formData, "assetId");
  const expectedVersion = wholeNumber(formData, "expectedVersion");
  if (!isUuid(assetId) || expectedVersion === null) return refused(UNREADABLE);

  const current = await getMediaAsset(assetId);
  if (!current.ok) return refused(current.error);
  const { asset } = current.data;
  if (asset.version !== expectedVersion) return refused(STALE);

  const alt = text(formData, "altText").trim();
  // Approved images always keep suitable alt text; others may clear it.
  if (alt !== "" || asset.status === "approved") {
    const problem = altTextProblem(alt);
    if (problem) return refused(problem, { fieldErrors: { altText: [problem] } });
  }

  const result = await updateMediaAsset(
    assetId,
    expectedVersion,
    alt === "" ? null : alt,
    asset.status,
  );
  if (!result.ok) return refused(result.error);
  revalidateMedia(assetId);
  return { message: "Alt text saved.", version: result.data.version };
}

export async function changeMediaStatusAction(
  _prev: MediaActionState,
  formData: FormData,
): Promise<MediaActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  const assetId = text(formData, "assetId");
  const expectedVersion = wholeNumber(formData, "expectedVersion");
  const change = text(formData, "change");
  if (!isUuid(assetId) || expectedVersion === null || !isMediaStatusChange(change)) {
    return refused(UNREADABLE);
  }

  const current = await getMediaAsset(assetId);
  if (!current.ok) return refused(current.error);
  const { asset } = current.data;
  if (asset.version !== expectedVersion) return refused(STALE);
  const rule = MEDIA_STATUS_CHANGES[change];
  if (!rule.from.includes(asset.status)) return refused(STALE);
  if (change === "approve") {
    const problem = altTextProblem(asset.altText);
    if (problem) return refused(`Add suitable alt text before approving. ${problem}`);
  }

  const result = await updateMediaAsset(assetId, expectedVersion, asset.altText, rule.to);
  if (!result.ok) return refused(result.error);
  revalidateMedia(assetId);
  const messages = {
    approve: "Image approved. It can now be chosen for website content.",
    withdraw: "Approval withdrawn. The image is a Draft again.",
    retire: "Image retired. It can no longer be chosen for new content.",
    restore: "Image restored to Draft. Approve it again before use.",
  } as const;
  return { message: messages[change], version: result.data.version };
}

// ---------------------------------------------------------------------------
// Incomplete uploads

/** Takes no input: the list is always read again on the server. */
export async function removeIncompleteUploadsAction(): Promise<MediaActionState> {
  if (!(await authorized())) return refused(NOT_AUTHORIZED);
  // The list is read again here: only files that are still unrecorded and
  // older than 24 hours are removed (the Storage policy enforces it too).
  const current = await listIncompleteUploads();
  if (!current.ok) return refused(current.error);
  if (!current.data.available) {
    return refused(
      "Clean-up is not available until the media upload policy is approved.",
    );
  }
  const paths = current.data.items.map((i) => i.path);
  if (paths.length === 0)
    return { message: "There are no incomplete uploads to remove." };
  const removed = await removeStoredMedia(paths);
  revalidateMedia();
  return removed === paths.length
    ? {
        message:
          removed === 1
            ? "Removed 1 incomplete upload."
            : `Removed ${removed} incomplete uploads.`,
      }
    : refused(
        `Removed ${removed} of ${paths.length} incomplete uploads. Reload and try again.`,
      );
}
