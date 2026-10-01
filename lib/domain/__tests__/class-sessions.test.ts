import { describe, expect, it } from "vitest";
import {
  CLASS_SESSION_STATUSES,
  isClassSessionStatus,
  isValidTimeRange,
} from "@/lib/domain/class-sessions";

describe("CLASS_SESSION_STATUSES", () => {
  it("matches the class_sessions.status CHECK constraint exactly (FR-60)", () => {
    expect(CLASS_SESSION_STATUSES).toEqual([
      "scheduled",
      "completed",
      "cancelled",
      "rescheduled",
    ]);
  });
});

describe("isClassSessionStatus", () => {
  it("accepts every allowed status", () => {
    for (const status of CLASS_SESSION_STATUSES) {
      expect(isClassSessionStatus(status)).toBe(true);
    }
  });

  it("rejects an unrelated value", () => {
    expect(isClassSessionStatus("present")).toBe(false);
    expect(isClassSessionStatus(null)).toBe(false);
    expect(isClassSessionStatus(42)).toBe(false);
  });
});

describe("isValidTimeRange", () => {
  it("accepts an end time after the start time", () => {
    expect(isValidTimeRange("09:00", "11:00")).toBe(true);
  });

  it("rejects an end time before the start time", () => {
    expect(isValidTimeRange("11:00", "09:00")).toBe(false);
  });

  it("rejects an end time equal to the start time", () => {
    expect(isValidTimeRange("09:00", "09:00")).toBe(false);
  });

  it("treats either value missing as valid (no range to check)", () => {
    expect(isValidTimeRange(null, "11:00")).toBe(true);
    expect(isValidTimeRange("09:00", null)).toBe(true);
    expect(isValidTimeRange(null, null)).toBe(true);
  });
});
