import { describe, expect, it } from "vitest";
import {
  batchProfileSchema,
  batchStatusSchema,
  trainerAssignmentSchema,
} from "@/lib/validation/batches";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

function baseInput() {
  return {
    programId: VALID_UUID,
    name: "September 2026 Weekend Batch",
    startDate: "2026-09-01",
    expectedEndDate: "",
    daysOfWeek: "",
    startTime: "",
    endTime: "",
    timezone: "",
    deliveryMode: "",
    capacity: "",
    meetingLink: "",
    location: "",
    notes: "",
  };
}

describe("batchProfileSchema", () => {
  it("accepts a minimal valid submission, defaulting optional fields", () => {
    const result = batchProfileSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      programId: VALID_UUID,
      name: "September 2026 Weekend Batch",
      startDate: "2026-09-01",
      expectedEndDate: null,
      daysOfWeek: [],
      startTime: null,
      endTime: null,
      timezone: "Asia/Kolkata",
      deliveryMode: null,
      capacity: null,
      meetingLink: null,
      location: null,
      notes: null,
    });
  });

  it("requires a valid program id (uuid)", () => {
    const missing = batchProfileSchema.safeParse({ ...baseInput(), programId: "" });
    expect(missing.success).toBe(false);

    const notAUuid = batchProfileSchema.safeParse({
      ...baseInput(),
      programId: "not-a-uuid",
    });
    expect(notAUuid.success).toBe(false);
  });

  it("requires batch name and start date", () => {
    expect(batchProfileSchema.safeParse({ ...baseInput(), name: "" }).success).toBe(
      false,
    );
    expect(batchProfileSchema.safeParse({ ...baseInput(), startDate: "" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed start date", () => {
    const result = batchProfileSchema.safeParse({
      ...baseInput(),
      startDate: "09/01/2026",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an expected end date before the start date", () => {
    const result = batchProfileSchema.safeParse({
      ...baseInput(),
      startDate: "2026-09-01",
      expectedEndDate: "2026-08-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.expectedEndDate?.[0]).toMatch(
        /cannot be before/i,
      );
    }
  });

  it("accepts an expected end date on or after the start date", () => {
    const sameDay = batchProfileSchema.safeParse({
      ...baseInput(),
      startDate: "2026-09-01",
      expectedEndDate: "2026-09-01",
    });
    expect(sameDay.success).toBe(true);

    const later = batchProfileSchema.safeParse({
      ...baseInput(),
      startDate: "2026-09-01",
      expectedEndDate: "2026-12-01",
    });
    expect(later.success).toBe(true);
  });

  it("parses comma-separated days of week into an array", () => {
    const result = batchProfileSchema.safeParse({
      ...baseInput(),
      daysOfWeek: "sat, sun",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.daysOfWeek).toEqual(["sat", "sun"]);
  });

  it("rejects a malformed start/end time", () => {
    const badStart = batchProfileSchema.safeParse({ ...baseInput(), startTime: "9am" });
    expect(badStart.success).toBe(false);

    const badEnd = batchProfileSchema.safeParse({ ...baseInput(), endTime: "25:00" });
    expect(badEnd.success).toBe(false);
  });

  it("accepts valid start/end times", () => {
    const result = batchProfileSchema.safeParse({
      ...baseInput(),
      startTime: "09:00",
      endTime: "17:30",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startTime).toBe("09:00");
      expect(result.data.endTime).toBe("17:30");
    }
  });

  it("defaults timezone to Asia/Kolkata when blank, and preserves an explicit value", () => {
    const blank = batchProfileSchema.safeParse(baseInput());
    expect(blank.success).toBe(true);
    if (blank.success) expect(blank.data.timezone).toBe("Asia/Kolkata");

    const explicit = batchProfileSchema.safeParse({
      ...baseInput(),
      timezone: "America/New_York",
    });
    expect(explicit.success).toBe(true);
    if (explicit.success) expect(explicit.data.timezone).toBe("America/New_York");
  });

  it("requires capacity to be a positive whole number when provided", () => {
    expect(batchProfileSchema.safeParse({ ...baseInput(), capacity: "0" }).success).toBe(
      false,
    );
    expect(batchProfileSchema.safeParse({ ...baseInput(), capacity: "-5" }).success).toBe(
      false,
    );
    expect(
      batchProfileSchema.safeParse({ ...baseInput(), capacity: "12.5" }).success,
    ).toBe(false);

    const valid = batchProfileSchema.safeParse({ ...baseInput(), capacity: "30" });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.capacity).toBe(30);
  });

  it("rejects a delivery mode outside the schema's CHECK constraint", () => {
    const result = batchProfileSchema.safeParse({
      ...baseInput(),
      deliveryMode: "remote",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid delivery mode", () => {
    const result = batchProfileSchema.safeParse({
      ...baseInput(),
      deliveryMode: "hybrid",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.deliveryMode).toBe("hybrid");
  });
});

describe("batchStatusSchema", () => {
  it("accepts every schema-supported status", () => {
    for (const status of [
      "draft",
      "upcoming",
      "active",
      "completed",
      "cancelled",
      "archived",
    ]) {
      expect(batchStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("rejects an unsupported status", () => {
    expect(batchStatusSchema.safeParse({ status: "paused" }).success).toBe(false);
  });
});

describe("trainerAssignmentSchema", () => {
  it("requires a valid trainer id (uuid)", () => {
    expect(trainerAssignmentSchema.safeParse({ trainerId: "" }).success).toBe(false);
    expect(trainerAssignmentSchema.safeParse({ trainerId: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(trainerAssignmentSchema.safeParse({ trainerId: VALID_UUID }).success).toBe(
      true,
    );
  });

  it("treats isPrimary as a boolean, false by default", () => {
    const unchecked = trainerAssignmentSchema.safeParse({ trainerId: VALID_UUID });
    expect(unchecked.success).toBe(true);
    if (unchecked.success) expect(unchecked.data.isPrimary).toBe(false);

    const checked = trainerAssignmentSchema.safeParse({
      trainerId: VALID_UUID,
      isPrimary: "on",
    });
    expect(checked.success).toBe(true);
    if (checked.success) expect(checked.data.isPrimary).toBe(true);
  });
});
