import {
  containsMarkup,
  containsPrice,
  type WebsiteErrorKind,
} from "@/lib/domain/website";
import type { WebsiteDocumentKind } from "@/lib/supabase/database.types";

/**
 * Phase 22B-3: website media rules (pure; used by the browser, the server
 * actions and the screens). The database (Phase 22A, plus the reviewed upload
 * proposal) enforces the same limits again.
 */

export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_MAX_DIMENSION = 10000;
export const MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type MediaMimeType = (typeof MEDIA_MIME_TYPES)[number];

export const MEDIA_EXTENSIONS: Record<MediaMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MEDIA_TYPE_LABELS: Record<MediaMimeType, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
};

/** For the file input; the bytes are still checked. */
export const MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

/** How long an Admin preview link stays valid. */
export const MEDIA_PREVIEW_SECONDS = 600;

/** Unrecorded uploads older than this can be removed by any Admin. */
export const INCOMPLETE_UPLOAD_HOURS = 24;

export function isMediaMimeType(value: unknown): value is MediaMimeType {
  return (
    typeof value === "string" && (MEDIA_MIME_TYPES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Status

export type MediaStatus = "draft" | "approved" | "retired";

export const MEDIA_STATUSES: readonly MediaStatus[] = ["draft", "approved", "retired"];

export const MEDIA_STATUS_LABELS: Record<MediaStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  retired: "Retired",
};

export function isMediaStatus(value: unknown): value is MediaStatus {
  return (
    typeof value === "string" && (MEDIA_STATUSES as readonly string[]).includes(value)
  );
}

export type MediaStatusChange = "approve" | "withdraw" | "retire" | "restore";

/** The status each change leads to, and the status it starts from. */
export const MEDIA_STATUS_CHANGES: Record<
  MediaStatusChange,
  { from: readonly MediaStatus[]; to: MediaStatus; label: string; confirm: boolean }
> = {
  approve: { from: ["draft"], to: "approved", label: "Approve", confirm: true },
  withdraw: {
    from: ["approved"],
    to: "draft",
    label: "Withdraw approval",
    confirm: true,
  },
  retire: { from: ["draft", "approved"], to: "retired", label: "Retire", confirm: true },
  restore: { from: ["retired"], to: "draft", label: "Restore to Draft", confirm: false },
};

export function isMediaStatusChange(value: unknown): value is MediaStatusChange {
  return typeof value === "string" && value in MEDIA_STATUS_CHANGES;
}

/** The changes offered for an image in this status. */
export function availableStatusChanges(status: MediaStatus): MediaStatusChange[] {
  return (Object.keys(MEDIA_STATUS_CHANGES) as MediaStatusChange[]).filter((c) =>
    MEDIA_STATUS_CHANGES[c].from.includes(status),
  );
}

// ---------------------------------------------------------------------------
// Alt text

export const ALT_TEXT_MIN = 5;
export const ALT_TEXT_MAX = 250;

const FILE_NAME_LIKE = /\.(jpe?g|png|webp|gif|svg|heic|bmp|tiff?)$/i;
const CAMERA_NAME_LIKE = /^(img|dsc|dscn|pxl|image|photo|screenshot)[\s_-]*\d+$/i;

/**
 * Why this alt text is not suitable, or null. Stricter than the database,
 * which only requires some alt text before approval: it must describe the
 * image in words, not be a file name, and follow the website text rules.
 */
export function altTextProblem(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (text === "") return "Add alt text that describes the image.";
  if (text.length < ALT_TEXT_MIN) {
    return `Alt text must be at least ${ALT_TEXT_MIN} characters and describe the image.`;
  }
  if (text.length > ALT_TEXT_MAX)
    return `Alt text must be ${ALT_TEXT_MAX} characters or fewer.`;
  if (FILE_NAME_LIKE.test(text) || CAMERA_NAME_LIKE.test(text)) {
    return "Alt text should describe the image, not repeat its file name.";
  }
  if (containsMarkup(text)) return "Alt text must be plain text, without HTML or code.";
  if (containsPrice(text)) return "Alt text must not include prices.";
  return null;
}

// ---------------------------------------------------------------------------
// Storage paths

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEDIA_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/** Same rule as website_media_path_is_valid(): "<uuid>/<name>.<jpg|jpeg|png|webp>". */
export function isMediaPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    MEDIA_PATH.test(path) &&
    /\.(jpe?g|png|webp)$/i.test(path) &&
    !path.includes("..")
  );
}

/** The extension a media path ends with, as a MIME type. */
export function mediaPathType(path: string): MediaMimeType | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return null;
}

/**
 * A safe file name for storage: letters, digits, ".", "_" and "-" only,
 * starting with a letter or digit, at most 80 characters before the
 * extension. The extension always comes from the detected type.
 */
export function safeMediaFileName(original: string, type: MediaMimeType): string {
  const baseName = original.slice(
    Math.max(original.lastIndexOf("/"), original.lastIndexOf("\\")) + 1,
  );
  const withoutExt = baseName.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const base = withoutExt
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[^A-Za-z0-9]+$/, "")
    .slice(0, 80)
    .replace(/[^A-Za-z0-9]+$/, "");
  return `${base || "image"}.${MEDIA_EXTENSIONS[type]}`;
}

/** A unique storage path under a fresh random folder. */
export function buildMediaPath(folderId: string, original: string, type: MediaMimeType) {
  if (!UUID.test(folderId)) throw new Error("Media folder must be a lower-case UUID");
  return `${folderId}/${safeMediaFileName(original, type)}`;
}

/** The file name part of a media path, for display. */
export function mediaFileName(path: string): string {
  return path.slice(path.indexOf("/") + 1);
}

// ---------------------------------------------------------------------------
// Image content check (reads the actual bytes; ignores names and claims)

export type ImageInfo = { type: MediaMimeType; width: number; height: number };
export type ImageCheck = { ok: true; info: ImageInfo } | { ok: false; reason: string };

const NOT_AN_IMAGE =
  "This file is not a valid JPEG, PNG or WebP image. Export it again as JPEG, PNG or WebP and try again.";

function u16be(b: Uint8Array, i: number) {
  return (b[i] << 8) | b[i + 1];
}
function u32be(b: Uint8Array, i: number) {
  return ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
}
function u16le(b: Uint8Array, i: number) {
  return b[i] | (b[i + 1] << 8);
}
function u24le(b: Uint8Array, i: number) {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}
function u32le(b: Uint8Array, i: number) {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}
function ascii(b: Uint8Array, i: number, n: number) {
  let s = "";
  for (let k = 0; k < n && i + k < b.length; k += 1) s += String.fromCharCode(b[i + k]);
  return s;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function inspectPng(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 8 + 25 + 12) return null;
  // First chunk must be IHDR (length 13); the file must end with IEND.
  if (u32be(b, 8) !== 13 || ascii(b, 12, 4) !== "IHDR") return null;
  if (ascii(b, b.length - 8, 4) !== "IEND") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function inspectJpeg(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  // The end-of-image marker must be near the end (allowing short padding).
  let hasEnd = false;
  for (let i = b.length - 2; i >= Math.max(2, b.length - 1024); i -= 1) {
    if (b[i] === 0xff && b[i + 1] === 0xd9) {
      hasEnd = true;
      break;
    }
  }
  if (!hasEnd) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    while (i < b.length && b[i] === 0xff) i += 1; // fill bytes
    const marker = b[i];
    i += 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7))
      continue;
    if (marker === 0xd9 || marker === 0xda) return null; // no frame header before data
    if (i + 1 >= b.length) return null;
    const length = u16be(b, i);
    if (length < 2 || i + length > b.length) return null;
    const isFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrame) {
      if (length < 7) return null;
      return { height: u16be(b, i + 3), width: u16be(b, i + 5) };
    }
    i += length;
  }
  return null;
}

function inspectWebp(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP")
    return null;
  const riffEnd = u32le(b, 4) + 8;
  if (riffEnd > b.length || riffEnd < b.length - 1) return null; // truncated or trailing data
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

/**
 * Checks the actual file content: a real JPEG, PNG or WebP structure, at most
 * 5 MiB, with dimensions of 1 to 10000 pixels. The file name and the type the
 * browser reports are ignored.
 */
export function inspectImage(bytes: Uint8Array): ImageCheck {
  if (bytes.length === 0) return { ok: false, reason: "The file is empty." };
  if (bytes.length > MEDIA_MAX_BYTES) {
    return { ok: false, reason: "The file is larger than 5 MB. Use a smaller image." };
  }
  let type: MediaMimeType | null = null;
  let size: { width: number; height: number } | null = null;
  if (PNG_SIGNATURE.every((v, i) => bytes[i] === v)) {
    type = "image/png";
    size = inspectPng(bytes);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    type = "image/jpeg";
    size = inspectJpeg(bytes);
  } else if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    type = "image/webp";
    size = inspectWebp(bytes);
  }
  if (!type || !size) return { ok: false, reason: NOT_AN_IMAGE };
  const { width, height } = size;
  if (width < 1 || height < 1) return { ok: false, reason: NOT_AN_IMAGE };
  if (width > MEDIA_MAX_DIMENSION || height > MEDIA_MAX_DIMENSION) {
    return {
      ok: false,
      reason: `The image is larger than ${MEDIA_MAX_DIMENSION} pixels on a side. Resize it and try again.`,
    };
  }
  return { ok: true, info: { type, width, height } };
}

// ---------------------------------------------------------------------------
// Where images can be chosen

export type DocumentImageSlots = { main: boolean; social: boolean };

/** Page-level image slots for each kind of website document. */
export const DOCUMENT_IMAGE_SLOTS: Record<WebsiteDocumentKind, DocumentImageSlots> = {
  home: { main: true, social: true },
  about: { main: true, social: true },
  corporate_training: { main: true, social: true },
  institutions: { main: true, social: true },
  programs_listing: { main: true, social: true },
  upcoming_batches: { main: true, social: true },
  program: { main: true, social: true },
  contact: { main: false, social: true },
  legal: { main: false, social: true },
  navigation: { main: false, social: false },
  footer: { main: false, social: false },
};

/** Section types that carry an image. */
export const SECTION_IMAGE_TYPES: ReadonlySet<string> = new Set(["hero", "banner"]);

/** Every image id a draft refers to (main, social and section images). */
export function contentImageIds(content: {
  heroImageAssetId: string | null;
  socialImageAssetId: string | null;
  sections: ReadonlyArray<{ imageAssetId?: string }>;
}): string[] {
  const ids = [
    content.heroImageAssetId,
    content.socialImageAssetId,
    ...content.sections.map((s) => s.imageAssetId ?? null),
  ];
  return [...new Set(ids.filter((v): v is string => typeof v === "string" && v !== ""))];
}

export const UNAPPROVED_IMAGES_MESSAGE =
  "Every image must be Approved before publishing. Approve the image in Media, or choose another.";

// ---------------------------------------------------------------------------
// Display and messages

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const UPLOADS_NOT_ENABLED_MESSAGE =
  "Uploading is not enabled yet: the website media upload policy is awaiting approval. Nothing was uploaded.";

/** Plain-language message for a database error from the media functions. */
export function mediaMessage(
  kind: WebsiteErrorKind,
  databaseMessage?: string | null,
): string {
  switch (kind) {
    case "not_allowed":
      return "Only an active Admin or Super Admin can manage website media.";
    case "stale":
      return "Someone else changed this image after you opened it. Reload to see the latest details, then try again.";
    case "not_found":
      return "This image no longer exists. Reload the page.";
    case "duplicate":
    case "invalid_state":
    case "invalid_input": {
      const text = (databaseMessage ?? "").trim();
      if (!text) return "Something went wrong. Please try again.";
      return /[.!?]$/.test(text) ? text : `${text}.`;
    }
    default:
      return "Something went wrong. Please try again.";
  }
}
