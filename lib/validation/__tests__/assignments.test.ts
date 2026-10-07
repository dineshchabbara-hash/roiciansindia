import { describe, expect, it } from "vitest";
import {
  createAssignmentSchema,
  parseCreateAssignmentFormData,
  submitAssignmentSchema,
  reviewSubmissionSchema,
  parseReviewSubmissionFormData,
} from "@/lib/validation/assignments";

describe("createAssignmentSchema", () => {
  it("accepts a minimal valid assignment", () => {
    const result = createAssignmentSchema.safeParse({
      title: "Essay 1",
      dueDate: "2026-03-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a blank title", () => {
    const result = createAssignmentSchema.safeParse({
      title: "",
      dueDate: "2026-03-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed due date", () => {
    const result = createAssignmentSchema.safeParse({
      title: "Essay 1",
      dueDate: "03/01/2026",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed uuid for moduleId", () => {
    const result = createAssignmentSchema.safeParse({
      title: "Essay 1",
      dueDate: "2026-03-01",
      moduleId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative maxMarks", () => {
    const result = createAssignmentSchema.safeParse({
      title: "Essay 1",
      dueDate: "2026-03-01",
      maxMarks: "-5",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty-string maxMarks as absent", () => {
    const result = createAssignmentSchema.safeParse({
      title: "Essay 1",
      dueDate: "2026-03-01",
      maxMarks: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.maxMarks).toBeNull();
  });
});

describe("parseCreateAssignmentFormData", () => {
  it("reads all fields from FormData and normalizes maxMarks to a number", () => {
    const formData = new FormData();
    formData.set("title", "Essay 1");
    formData.set("description", "Write 500 words.");
    formData.set("dueDate", "2026-03-01");
    formData.set("maxMarks", "100");

    const result = parseCreateAssignmentFormData(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Essay 1");
      expect(result.data.maxMarks).toBe(100);
      expect(result.data.moduleId).toBeNull();
    }
  });

  it("fails when the title is missing", () => {
    const formData = new FormData();
    formData.set("dueDate", "2026-03-01");
    const result = parseCreateAssignmentFormData(formData);
    expect(result.success).toBe(false);
  });
});

describe("submitAssignmentSchema", () => {
  it("transforms an empty textResponse to null", () => {
    const result = submitAssignmentSchema.parse({ textResponse: "" });
    expect(result.textResponse).toBeNull();
  });

  it("keeps a real textResponse", () => {
    const result = submitAssignmentSchema.parse({ textResponse: "My answer" });
    expect(result.textResponse).toBe("My answer");
  });
});

describe("reviewSubmissionSchema", () => {
  it("accepts a review with marks and the 'reviewed' outcome", () => {
    const result = reviewSubmissionSchema.safeParse({
      marks: "85",
      trainerFeedback: "Good work",
      nextStatus: "reviewed",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an outcome outside the two reviewer-set statuses", () => {
    const result = reviewSubmissionSchema.safeParse({
      nextStatus: "submitted",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative marks", () => {
    const result = reviewSubmissionSchema.safeParse({
      marks: "-1",
      nextStatus: "reviewed",
    });
    expect(result.success).toBe(false);
  });
});

describe("parseReviewSubmissionFormData", () => {
  it("normalizes marks to a number and keeps the chosen status", () => {
    const formData = new FormData();
    formData.set("marks", "72.5");
    formData.set("trainerFeedback", "Nice effort");
    formData.set("nextStatus", "resubmission_requested");

    const result = parseReviewSubmissionFormData(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.marks).toBe(72.5);
      expect(result.data.nextStatus).toBe("resubmission_requested");
    }
  });
});
