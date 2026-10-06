import { describe, expect, it } from "vitest";
import {
  createMaterialSchema,
  parseCreateMaterialFormData,
} from "@/lib/validation/materials";

describe("createMaterialSchema", () => {
  it("accepts a valid file material with no externalUrl", () => {
    const result = createMaterialSchema.safeParse({
      title: "Syllabus",
      description: "",
      materialType: "file",
      externalUrl: "",
      programId: "11111111-1111-4111-8111-111111111111",
      batchId: "",
      moduleId: "",
      classSessionId: "",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid link material with a valid externalUrl", () => {
    const result = createMaterialSchema.safeParse({
      title: "Reference",
      materialType: "link",
      externalUrl: "https://example.com/doc",
      programId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a blank title", () => {
    const result = createMaterialSchema.safeParse({
      title: "",
      materialType: "file",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid materialType not in the CHECK-constraint set", () => {
    const result = createMaterialSchema.safeParse({
      title: "Syllabus",
      materialType: "document",
    });
    expect(result.success).toBe(false);
  });

  it("mirrors the materials_file_or_link CHECK: a link material without externalUrl fails", () => {
    const result = createMaterialSchema.safeParse({
      title: "Reference",
      materialType: "link",
      externalUrl: "",
    });
    expect(result.success).toBe(false);
  });

  it("mirrors the materials_file_or_link CHECK: a video material without externalUrl fails", () => {
    const result = createMaterialSchema.safeParse({
      title: "Recording",
      materialType: "video",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed externalUrl", () => {
    const result = createMaterialSchema.safeParse({
      title: "Reference",
      materialType: "link",
      externalUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("does not enforce the exactly-one-scope rule at this layer (that lives only in resolveExactlyOneScope)", () => {
    // Shape-level validation only — a material with zero or multiple scope
    // ids is still shape-valid here; resolveExactlyOneScope is the single
    // place the business rule is enforced, per this module's own comment.
    const result = createMaterialSchema.safeParse({
      title: "Syllabus",
      materialType: "file",
      programId: "11111111-1111-4111-8111-111111111111",
      batchId: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed uuid for a scope id field", () => {
    const result = createMaterialSchema.safeParse({
      title: "Syllabus",
      materialType: "file",
      programId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("transforms empty-string optional fields to null", () => {
    const result = createMaterialSchema.safeParse({
      title: "Syllabus",
      description: "",
      materialType: "file",
      programId: "11111111-1111-4111-8111-111111111111",
      batchId: "",
      moduleId: "",
      classSessionId: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
      expect(result.data.batchId).toBeNull();
      expect(result.data.moduleId).toBeNull();
      expect(result.data.classSessionId).toBeNull();
    }
  });
});

describe("parseCreateMaterialFormData", () => {
  it("reads all eight fields from FormData", () => {
    const formData = new FormData();
    formData.set("title", "Syllabus");
    formData.set("description", "Course overview");
    formData.set("materialType", "file");
    formData.set("programId", "11111111-1111-4111-8111-111111111111");

    const result = parseCreateMaterialFormData(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Syllabus");
      expect(result.data.description).toBe("Course overview");
      expect(result.data.materialType).toBe("file");
      expect(result.data.programId).toBe("11111111-1111-4111-8111-111111111111");
    }
  });

  it("fails when required fields are entirely missing", () => {
    const formData = new FormData();
    const result = parseCreateMaterialFormData(formData);
    expect(result.success).toBe(false);
  });
});
