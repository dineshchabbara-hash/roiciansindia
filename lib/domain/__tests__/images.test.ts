import { describe, expect, it } from "vitest";
import { checkImageUpload, sniffImageType } from "@/lib/domain/images";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = new Uint8Array([
  ...Buffer.from("RIFF"),
  0,
  0,
  0,
  0,
  ...Buffer.from("WEBP"),
  0,
]);
const SVG = new Uint8Array(
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
);
const GIF = new Uint8Array(Buffer.from("GIF89a......"));

describe("sniffImageType", () => {
  it("identifies PNG, JPEG and WebP from their bytes", () => {
    expect(sniffImageType(PNG)).toBe("png");
    expect(sniffImageType(JPG)).toBe("jpg");
    expect(sniffImageType(WEBP)).toBe("webp");
  });
  it("rejects SVG, GIF and anything else", () => {
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(GIF)).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("checkImageUpload", () => {
  it("returns the extension and content type for an accepted image", () => {
    expect(checkImageUpload(PNG, 100, "100 B")).toEqual({
      ok: true,
      extension: "png",
      contentType: "image/png",
    });
  });
  it("refuses empty, oversized and non-image uploads", () => {
    expect(checkImageUpload(new Uint8Array(), 100, "100 B")).toEqual({
      ok: false,
      error: "Choose an image to upload.",
    });
    expect(checkImageUpload(PNG, 5, "5 B")).toEqual({
      ok: false,
      error: "The image is too large. Maximum size is 5 B.",
    });
    expect(checkImageUpload(SVG, 1000, "1 KB")).toEqual({
      ok: false,
      error: "Upload a PNG, JPEG or WebP image.",
    });
  });
});
