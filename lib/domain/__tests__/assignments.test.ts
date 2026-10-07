import { describe, expect, it } from "vitest";
import {
  resolveSubmissionStatusForNow,
  isMarksWithinCeiling,
  buildAssignmentAttachmentPath,
  buildAssignmentSubmissionPath,
  assignmentDisplayFileName,
  isAssignmentExtensionAllowed,
  isAssignmentFileSizeAllowed,
  matchesAssignmentFileSignature,
  getFileExtension,
} from "@/lib/domain/assignments";

describe("resolveSubmissionStatusForNow", () => {
  it("returns 'submitted' when submitted before the due date", () => {
    const now = new Date("2026-01-10T12:00:00.000Z");
    expect(resolveSubmissionStatusForNow("2026-01-15", now)).toBe("submitted");
  });

  it("returns 'submitted' when submitted exactly on the due date", () => {
    const now = new Date("2026-01-15T23:59:00.000Z");
    expect(resolveSubmissionStatusForNow("2026-01-15", now)).toBe("submitted");
  });

  it("returns 'late' when submitted after the due date", () => {
    const now = new Date("2026-01-16T00:01:00.000Z");
    expect(resolveSubmissionStatusForNow("2026-01-15", now)).toBe("late");
  });
});

describe("isMarksWithinCeiling", () => {
  it("rejects negative marks regardless of ceiling", () => {
    expect(isMarksWithinCeiling(-1, 100)).toBe(false);
    expect(isMarksWithinCeiling(-1, null)).toBe(false);
  });

  it("accepts any non-negative value when there is no ceiling", () => {
    expect(isMarksWithinCeiling(1000, null)).toBe(true);
  });

  it("accepts marks at or below the ceiling", () => {
    expect(isMarksWithinCeiling(50, 50)).toBe(true);
    expect(isMarksWithinCeiling(49.5, 50)).toBe(true);
  });

  it("rejects marks above the ceiling", () => {
    expect(isMarksWithinCeiling(50.01, 50)).toBe(false);
  });
});

describe("storage path builders", () => {
  it("builds a deterministic 2-segment attachment path", () => {
    const path = buildAssignmentAttachmentPath(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "Homework 1.pdf",
    );
    expect(path).toBe(
      "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222-Homework_1.pdf",
    );
  });

  it("builds a deterministic 3-segment submission path", () => {
    const path = buildAssignmentSubmissionPath(
      "11111111-1111-4111-8111-111111111111",
      "33333333-3333-4333-8333-333333333333",
      "22222222-2222-4222-8222-222222222222",
      "answer.docx",
    );
    expect(path).toBe(
      "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222-answer.docx",
    );
  });

  it("sanitizes path-traversal attempts out of the original filename", () => {
    const path = buildAssignmentAttachmentPath(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "../../etc/passwd",
    );
    expect(path).not.toContain("..");
    expect(path.split("/")).toHaveLength(2);
  });

  it("recovers the sanitized display filename from a stored path", () => {
    const path = buildAssignmentAttachmentPath(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "Syllabus.pdf",
    );
    expect(assignmentDisplayFileName(path)).toBe("Syllabus.pdf");
  });
});

describe("file validation", () => {
  it("allows the documented document/image extensions only", () => {
    expect(isAssignmentExtensionAllowed("report.pdf")).toBe(true);
    expect(isAssignmentExtensionAllowed("photo.png")).toBe(true);
    expect(isAssignmentExtensionAllowed("script.exe")).toBe(false);
    expect(isAssignmentExtensionAllowed("archive.zip")).toBe(false);
  });

  it("is case-insensitive on extension", () => {
    expect(getFileExtension("Report.PDF")).toBe("pdf");
    expect(isAssignmentExtensionAllowed("Report.PDF")).toBe(true);
  });

  it("enforces the 10MB document / 5MB image size limits", () => {
    expect(isAssignmentFileSizeAllowed("a.pdf", 10 * 1024 * 1024)).toBe(true);
    expect(isAssignmentFileSizeAllowed("a.pdf", 10 * 1024 * 1024 + 1)).toBe(false);
    expect(isAssignmentFileSizeAllowed("a.png", 5 * 1024 * 1024)).toBe(true);
    expect(isAssignmentFileSizeAllowed("a.png", 5 * 1024 * 1024 + 1)).toBe(false);
  });

  it("matches the PDF signature only for an actual %PDF header", () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(matchesAssignmentFileSignature("a.pdf", pdfBytes)).toBe(true);
    expect(matchesAssignmentFileSignature("a.pdf", new Uint8Array([0, 0, 0, 0]))).toBe(
      false,
    );
  });

  it("rejects an unsupported extension even with a well-formed signature", () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    expect(matchesAssignmentFileSignature("a.exe", pdfBytes)).toBe(false);
  });

  it("only proves 'well-formed OLE2 container', not which legacy Office subtype (honest truth table, same as Materials)", () => {
    const ole2Bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(matchesAssignmentFileSignature("a.doc", ole2Bytes)).toBe(true);
    expect(matchesAssignmentFileSignature("a.ppt", ole2Bytes)).toBe(true);
    expect(matchesAssignmentFileSignature("a.xls", ole2Bytes)).toBe(true);
  });
});
