/**
 * Phase 21C — image uploads (company logo, FR-41 student profile photo).
 * Pure. The file type is decided from the file's own leading bytes, never
 * from its name or the browser-supplied MIME type, and only three raster
 * formats are accepted (no SVG: it can carry script).
 */

export type ImageExtension = "png" | "jpg" | "webp";

export const IMAGE_CONTENT_TYPES: Record<ImageExtension, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export const ACCEPTED_IMAGE_INPUT = "image/png,image/jpeg,image/webp";

/** The real image type of `bytes`, or null when it is not PNG/JPEG/WebP. */
export function sniffImageType(bytes: Uint8Array): ImageExtension | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export type ImageCheck =
  | { ok: true; extension: ImageExtension; contentType: string }
  | { ok: false; error: string };

/** Validates an uploaded image's size and real type. */
export function checkImageUpload(
  bytes: Uint8Array,
  maxBytes: number,
  maxLabel: string,
): ImageCheck {
  if (bytes.length === 0) return { ok: false, error: "Choose an image to upload." };
  if (bytes.length > maxBytes) {
    return { ok: false, error: `The image is too large. Maximum size is ${maxLabel}.` };
  }
  const extension = sniffImageType(bytes);
  if (!extension) {
    return { ok: false, error: "Upload a PNG, JPEG or WebP image." };
  }
  return { ok: true, extension, contentType: IMAGE_CONTENT_TYPES[extension] };
}
