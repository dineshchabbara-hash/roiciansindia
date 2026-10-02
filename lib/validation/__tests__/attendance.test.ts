import { describe, expect, it } from "vitest";
import {
  attendanceRosterEntrySchema,
  parseAttendanceRosterFormData,
} from "@/lib/validation/attendance";

describe("attendanceRosterEntrySchema", () => {
  const validEnrollmentId = "11111111-1111-4111-8111-111111111111";

  it("accepts a row with a valid status", () => {
    const result = attendanceRosterEntrySchema.safeParse({
      enrollmentId: validEnrollmentId,
      status: "present",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a row with no status (left unmarked)", () => {
    const result = attendanceRosterEntrySchema.safeParse({
      enrollmentId: validEnrollmentId,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID enrollmentId", () => {
    const result = attendanceRosterEntrySchema.safeParse({
      enrollmentId: "not-a-uuid",
      status: "present",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invented status value", () => {
    const result = attendanceRosterEntrySchema.safeParse({
      enrollmentId: validEnrollmentId,
      status: "tardy",
    });
    expect(result.success).toBe(false);
  });

  it("transforms blank notes to null", () => {
    const result = attendanceRosterEntrySchema.safeParse({
      enrollmentId: validEnrollmentId,
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notes).toBeNull();
  });
});

describe("parseAttendanceRosterFormData", () => {
  const idA = "11111111-1111-4111-8111-111111111111";
  const idB = "22222222-2222-4222-8222-222222222222";

  it("groups status/notes fields by enrollmentId", () => {
    const formData = new FormData();
    formData.set(`status__${idA}`, "present");
    formData.set(`notes__${idA}`, "On time");
    formData.set(`status__${idB}`, "absent");

    const entries = parseAttendanceRosterFormData(formData);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.enrollmentId === idA)).toEqual({
      enrollmentId: idA,
      status: "present",
      notes: "On time",
    });
    expect(entries.find((e) => e.enrollmentId === idB)).toEqual({
      enrollmentId: idB,
      status: "absent",
      notes: null,
    });
  });

  it("includes a row left unmarked (blank status) with status undefined, not dropped", () => {
    const formData = new FormData();
    formData.set(`status__${idA}`, "");

    const entries = parseAttendanceRosterFormData(formData);
    expect(entries).toEqual([{ enrollmentId: idA, status: undefined, notes: null }]);
  });

  it("silently drops a row with a malformed enrollmentId rather than throwing", () => {
    const formData = new FormData();
    formData.set("status__not-a-uuid", "present");

    const entries = parseAttendanceRosterFormData(formData);
    expect(entries).toEqual([]);
  });

  it("returns an empty array for a form with no roster fields", () => {
    const formData = new FormData();
    formData.set("unrelated", "value");
    expect(parseAttendanceRosterFormData(formData)).toEqual([]);
  });
});
