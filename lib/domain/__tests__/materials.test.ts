import { describe, expect, it } from "vitest";
import {
  MATERIAL_TYPES,
  isMaterialType,
  resolveExactlyOneScope,
  MATERIAL_ALLOWED_EXTENSIONS,
  getFileExtension,
  isMaterialExtensionAllowed,
  materialFileSizeLimitBytes,
  materialFileSizeLimitLabel,
  isMaterialFileSizeAllowed,
  MATERIAL_MAX_DOCUMENT_SIZE_BYTES,
  MATERIAL_MAX_IMAGE_SIZE_BYTES,
  matchesMaterialFileSignature,
  buildMaterialObjectPath,
  materialDisplayFileName,
} from "@/lib/domain/materials";

describe("isMaterialType", () => {
  it("accepts exactly the three CHECK-constraint values", () => {
    for (const type of MATERIAL_TYPES) {
      expect(isMaterialType(type)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isMaterialType("document")).toBe(false);
    expect(isMaterialType(null)).toBe(false);
    expect(isMaterialType(42)).toBe(false);
  });
});

describe("resolveExactlyOneScope", () => {
  const empty = { programId: null, batchId: null, moduleId: null, classSessionId: null };

  it("resolves a program-only input", () => {
    const result = resolveExactlyOneScope({ ...empty, programId: "p1" });
    expect(result).toEqual({ ok: true, scope: { type: "program", id: "p1" } });
  });

  it("resolves a batch-only input", () => {
    const result = resolveExactlyOneScope({ ...empty, batchId: "b1" });
    expect(result).toEqual({ ok: true, scope: { type: "batch", id: "b1" } });
  });

  it("resolves a module-only input", () => {
    const result = resolveExactlyOneScope({ ...empty, moduleId: "m1" });
    expect(result).toEqual({ ok: true, scope: { type: "module", id: "m1" } });
  });

  it("resolves a session-only input", () => {
    const result = resolveExactlyOneScope({ ...empty, classSessionId: "s1" });
    expect(result).toEqual({ ok: true, scope: { type: "session", id: "s1" } });
  });

  it("fails when nothing is provided", () => {
    const result = resolveExactlyOneScope(empty);
    expect(result.ok).toBe(false);
  });

  it("fails when more than one is provided, even though the DB CHECK would allow it", () => {
    const result = resolveExactlyOneScope({ ...empty, programId: "p1", batchId: "b1" });
    expect(result.ok).toBe(false);
  });
});

describe("isMaterialExtensionAllowed / getFileExtension", () => {
  it("accepts every allow-listed extension, case-insensitively", () => {
    for (const ext of MATERIAL_ALLOWED_EXTENSIONS) {
      expect(isMaterialExtensionAllowed(`report.${ext}`)).toBe(true);
      expect(isMaterialExtensionAllowed(`report.${ext.toUpperCase()}`)).toBe(true);
    }
  });

  it("rejects an executable or script extension", () => {
    expect(isMaterialExtensionAllowed("virus.exe")).toBe(false);
    expect(isMaterialExtensionAllowed("script.sh")).toBe(false);
  });

  it("rejects a filename with no extension at all", () => {
    expect(getFileExtension("README")).toBe("");
    expect(isMaterialExtensionAllowed("README")).toBe(false);
  });
});

describe("material file size limits", () => {
  it("applies the document limit to document extensions", () => {
    expect(materialFileSizeLimitBytes("notes.pdf")).toBe(
      MATERIAL_MAX_DOCUMENT_SIZE_BYTES,
    );
    expect(materialFileSizeLimitLabel("notes.pdf")).toBe("10 MB");
  });

  it("applies the smaller image limit to image extensions", () => {
    expect(materialFileSizeLimitBytes("cover.png")).toBe(MATERIAL_MAX_IMAGE_SIZE_BYTES);
    expect(materialFileSizeLimitLabel("cover.png")).toBe("5 MB");
  });

  it("returns null for a disallowed extension (no limit category applies)", () => {
    expect(materialFileSizeLimitBytes("virus.exe")).toBeNull();
  });

  it("isMaterialFileSizeAllowed is false for a disallowed extension regardless of size", () => {
    expect(isMaterialFileSizeAllowed("virus.exe", 1)).toBe(false);
  });

  it("isMaterialFileSizeAllowed enforces the exact boundary (<=, not <)", () => {
    expect(isMaterialFileSizeAllowed("cover.png", MATERIAL_MAX_IMAGE_SIZE_BYTES)).toBe(
      true,
    );
    expect(
      isMaterialFileSizeAllowed("cover.png", MATERIAL_MAX_IMAGE_SIZE_BYTES + 1),
    ).toBe(false);
  });
});

describe("matchesMaterialFileSignature", () => {
  it("accepts a correct %PDF signature for a .pdf extension", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(matchesMaterialFileSignature("notes.pdf", bytes)).toBe(true);
  });

  it("rejects a mismatched signature (claims .pdf, bytes are PNG)", () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(matchesMaterialFileSignature("notes.pdf", pngBytes)).toBe(false);
  });

  it("accepts a correct PNG signature for a .png extension", () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    expect(matchesMaterialFileSignature("cover.png", bytes)).toBe(true);
  });

  it("accepts a correct WEBP signature (RIFF....WEBP)", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(matchesMaterialFileSignature("cover.webp", bytes)).toBe(true);
  });

  it("rejects WEBP bytes too short to contain the WEBP marker", () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    expect(matchesMaterialFileSignature("cover.webp", bytes)).toBe(false);
  });

  it("returns false for an extension with no signature check at all", () => {
    expect(
      matchesMaterialFileSignature("notes.unknownext", new Uint8Array([1, 2, 3])),
    ).toBe(false);
  });
});

describe("buildMaterialObjectPath / materialDisplayFileName", () => {
  it("builds a deterministic {scopeType}/{scopeId}/{objectId}-{sanitizedName} path", () => {
    const path = buildMaterialObjectPath(
      { type: "batch", id: "batch-123" },
      "0a1b2c3d-1111-2222-3333-444455556666",
      "My Report.pdf",
    );
    expect(path).toBe(
      "batch/batch-123/0a1b2c3d-1111-2222-3333-444455556666-My_Report.pdf",
    );
  });

  it("recovers the sanitized original filename for display, stripping the object-id prefix", () => {
    const path = buildMaterialObjectPath(
      { type: "program", id: "prog-1" },
      "0a1b2c3d-1111-2222-3333-444455556666",
      "Syllabus.pdf",
    );
    expect(materialDisplayFileName(path)).toBe("Syllabus.pdf");
  });

  it("falls back to the full last path segment when no object-id prefix is present", () => {
    expect(materialDisplayFileName("some/path/plainname.pdf")).toBe("plainname.pdf");
  });
});
