import { describe, expect, it } from "vitest";
import {
  classSessionInputSchema,
  classSessionStatusSchema,
} from "@/lib/validation/class-sessions";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    sessionDate: "2026-09-01",
    startTime: "09:00",
    endTime: "11:00",
    topic: "Introduction",
    description: "Course overview",
    meetingLink: "https://meet.example.com/abc",
    notes: "Bring laptops",
    ...overrides,
  };
}

describe("classSessionInputSchema", () => {
  it("accepts a fully populated valid input", () => {
    const result = classSessionInputSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        sessionDate: "2026-09-01",
        startTime: "09:00",
        endTime: "11:00",
        topic: "Introduction",
        description: "Course overview",
        meetingLink: "https://meet.example.com/abc",
        notes: "Bring laptops",
      });
    }
  });

  it("requires sessionDate", () => {
    const result = classSessionInputSchema.safeParse(baseInput({ sessionDate: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects a malformed sessionDate", () => {
    const result = classSessionInputSchema.safeParse(
      baseInput({ sessionDate: "09/01/2026" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a malformed startTime", () => {
    const result = classSessionInputSchema.safeParse(baseInput({ startTime: "9am" }));
    expect(result.success).toBe(false);
  });

  it("rejects an endTime before the startTime", () => {
    const result = classSessionInputSchema.safeParse(
      baseInput({ startTime: "11:00", endTime: "09:00" }),
    );
    expect(result.success).toBe(false);
  });

  it("treats blank optional fields as null, not empty strings", () => {
    const result = classSessionInputSchema.safeParse(
      baseInput({
        startTime: "",
        endTime: "",
        topic: "",
        description: "",
        meetingLink: "",
        notes: "",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startTime).toBeNull();
      expect(result.data.endTime).toBeNull();
      expect(result.data.topic).toBeNull();
      expect(result.data.description).toBeNull();
      expect(result.data.meetingLink).toBeNull();
      expect(result.data.notes).toBeNull();
    }
  });

  it("never includes a batchId or status field — both are bound server-side, never form input", () => {
    const result = classSessionInputSchema.safeParse(
      baseInput({ batchId: "11111111-1111-4111-8111-111111111111", status: "completed" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("batchId");
      expect(result.data).not.toHaveProperty("status");
    }
  });
});

describe("classSessionStatusSchema", () => {
  it("accepts each allowed status", () => {
    for (const status of ["scheduled", "completed", "cancelled", "rescheduled"]) {
      expect(classSessionStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("rejects an unrelated status value", () => {
    expect(classSessionStatusSchema.safeParse({ status: "present" }).success).toBe(false);
  });
});
