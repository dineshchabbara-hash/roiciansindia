import { describe, expect, it } from "vitest";
import {
  DOCUMENT_IMAGE_SLOTS,
  MEDIA_MAX_BYTES,
  SECTION_IMAGE_TYPES,
  altTextProblem,
  availableStatusChanges,
  buildMediaPath,
  contentImageIds,
  formatBytes,
  inspectImage,
  isMediaPath,
  mediaFileName,
  mediaMessage,
  mediaPathType,
  safeMediaFileName,
} from "@/lib/domain/website-media";
import {
  JPEG_3x2,
  JPEG_PROGRESSIVE_17x9,
  PNG_3x2,
  WEBP_ALPHA_7x5,
  WEBP_LOSSLESS_6x3,
  WEBP_LOSSY_5x4,
  bytes,
} from "./fixtures/sample-images";

const text = (s: string) => new TextEncoder().encode(s);
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

describe("inspectImage reads the actual file content", () => {
  it.each([
    ["PNG", PNG_3x2, "image/png", 3, 2],
    ["baseline JPEG", JPEG_3x2, "image/jpeg", 3, 2],
    ["progressive JPEG", JPEG_PROGRESSIVE_17x9, "image/jpeg", 17, 9],
    ["lossy WebP", WEBP_LOSSY_5x4, "image/webp", 5, 4],
    ["lossless WebP", WEBP_LOSSLESS_6x3, "image/webp", 6, 3],
    ["WebP with transparency", WEBP_ALPHA_7x5, "image/webp", 7, 5],
  ])("accepts a real %s with its dimensions", (_name, b64, type, width, height) => {
    expect(inspectImage(bytes(b64))).toEqual({ ok: true, info: { type, width, height } });
  });

  it("refuses files that only pretend to be images", () => {
    const disguised = [
      text("<html><script>alert(1)</script></html>"),
      text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      text("GIF89a\x01\x00\x01\x00"),
      text("%PDF-1.7 fake"),
      bytes(PNG_3x2).slice(0, 8), // PNG signature only
      join(bytes(PNG_3x2), text("<html>hidden page</html>")), // data after IEND
      join(bytes(WEBP_LOSSY_5x4), text("<script>")), // data after the RIFF body
    ];
    for (const file of disguised) {
      const result = inspectImage(file);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/not a valid JPEG, PNG or WebP/);
    }
  });

  it("refuses truncated images", () => {
    for (const b64 of [
      PNG_3x2,
      JPEG_3x2,
      JPEG_PROGRESSIVE_17x9,
      WEBP_LOSSY_5x4,
      WEBP_ALPHA_7x5,
    ]) {
      const full = bytes(b64);
      expect(inspectImage(full.slice(0, Math.floor(full.length * 0.6))).ok).toBe(false);
    }
  });

  it("refuses empty files, files over 5 MB and images over 10000 pixels", () => {
    expect(inspectImage(new Uint8Array())).toEqual({
      ok: false,
      reason: "The file is empty.",
    });
    const big = new Uint8Array(MEDIA_MAX_BYTES + 1);
    big.set(bytes(PNG_3x2));
    expect(inspectImage(big)).toEqual({
      ok: false,
      reason: "The file is larger than 5 MB. Use a smaller image.",
    });
    const huge = bytes(PNG_3x2);
    huge.set([0, 0, 0x4e, 0x21], 16); // width 20001
    const result = inspectImage(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/larger than 10000 pixels/);
  });
});

describe("storage paths", () => {
  const folder = "0f0e0d0c-0b0a-4908-8706-050403020100";

  it("builds a safe file name whose extension comes from the detected type", () => {
    expect(safeMediaFileName("Team photo (final).PNG", "image/jpeg")).toBe(
      "Team-photo-final.jpg",
    );
    expect(safeMediaFileName("Café résumé.webp", "image/webp")).toBe("Cafe-resume.webp");
    expect(safeMediaFileName("../../etc/passwd", "image/png")).toBe("passwd.png");
    expect(safeMediaFileName("C:\\Users\\me\\photo.jpeg", "image/jpeg")).toBe(
      "photo.jpg",
    );
    expect(safeMediaFileName("....png", "image/png")).toBe("image.png");
    expect(safeMediaFileName("<script>.svg", "image/png")).toBe("script.png");
    expect(safeMediaFileName("x".repeat(300), "image/png")).toHaveLength(84);
  });

  it("builds paths under a fresh folder and recognises only safe paths", () => {
    const path = buildMediaPath(folder, "Hero image.png", "image/png");
    expect(path).toBe(`${folder}/Hero-image.png`);
    expect(isMediaPath(path)).toBe(true);
    expect(mediaFileName(path)).toBe("Hero-image.png");
    expect(mediaPathType(path)).toBe("image/png");
    expect(() => buildMediaPath("not-a-uuid", "a.png", "image/png")).toThrow();
    for (const bad of [
      "hero.png",
      `${folder.toUpperCase()}/hero.png`,
      `${folder}/nested/hero.png`,
      `${folder}/hero.svg`,
      `${folder}/.hidden.png`,
      `${folder}/a..b.png`,
      `../${folder}/hero.png`,
      42,
    ]) {
      expect(isMediaPath(bad)).toBe(false);
    }
  });
});

describe("alt text", () => {
  it("accepts a plain description", () => {
    expect(altTextProblem("Learners working together in a classroom")).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(altTextProblem("")).toMatch(/Add alt text/);
    expect(altTextProblem("  ")).toMatch(/Add alt text/);
    expect(altTextProblem("Logo")).toMatch(/at least 5 characters/);
    expect(altTextProblem("a".repeat(251))).toMatch(/250 characters or fewer/);
    expect(altTextProblem("hero-banner.jpg")).toMatch(/not repeat its file name/);
    expect(altTextProblem("IMG_1234")).toMatch(/not repeat its file name/);
    expect(altTextProblem("<b>Students</b>")).toMatch(/plain text/);
    expect(altTextProblem("Course for Rs 4,999")).toMatch(/prices/);
  });
});

describe("status changes", () => {
  it("offers the right changes for each status", () => {
    expect(availableStatusChanges("draft")).toEqual(["approve", "retire"]);
    expect(availableStatusChanges("approved")).toEqual(["withdraw", "retire"]);
    expect(availableStatusChanges("retired")).toEqual(["restore"]);
  });
});

describe("image slots and content images", () => {
  it("offers page-level images only where the page uses them", () => {
    expect(DOCUMENT_IMAGE_SLOTS.home).toEqual({ main: true, social: true });
    expect(DOCUMENT_IMAGE_SLOTS.program).toEqual({ main: true, social: true });
    expect(DOCUMENT_IMAGE_SLOTS.contact).toEqual({ main: false, social: true });
    expect(DOCUMENT_IMAGE_SLOTS.navigation).toEqual({ main: false, social: false });
    expect(SECTION_IMAGE_TYPES.has("hero")).toBe(true);
    expect(SECTION_IMAGE_TYPES.has("faq")).toBe(false);
  });

  it("collects every distinct image a draft uses", () => {
    expect(
      contentImageIds({
        heroImageAssetId: "a",
        socialImageAssetId: "a",
        sections: [{ imageAssetId: "b" }, {}, { imageAssetId: "" }],
      }),
    ).toEqual(["a", "b"]);
  });
});

describe("display and messages", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(20480)).toBe("20 KB");
    expect(formatBytes(MEDIA_MAX_BYTES)).toBe("5.0 MB");
  });

  it("uses fixed wording for refusals and the database's words for rule messages", () => {
    expect(mediaMessage("not_allowed", "secret")).toMatch(/Only an active Admin/);
    expect(mediaMessage("stale")).toMatch(/Someone else changed this image/);
    expect(mediaMessage("invalid_state", "This image is used by published content")).toBe(
      "This image is used by published content.",
    );
    expect(mediaMessage("unknown", "secret detail")).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
