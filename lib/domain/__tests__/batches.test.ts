import { describe, expect, it } from "vitest";
import {
  BATCH_STATUSES,
  formatDaysOfWeekForDisplay,
  isBatchStatus,
  isValidDateRange,
  parseDaysOfWeekInput,
} from "@/lib/domain/batches";

describe("isBatchStatus", () => {
  it("accepts exactly the 6 values the batches.status CHECK constraint allows", () => {
    for (const status of BATCH_STATUSES) {
      expect(isBatchStatus(status)).toBe(true);
    }
  });

  it("rejects values the schema does not support", () => {
    expect(isBatchStatus("suspended")).toBe(false);
    expect(isBatchStatus("")).toBe(false);
    expect(isBatchStatus(null)).toBe(false);
    expect(isBatchStatus(undefined)).toBe(false);
  });
});

describe("parseDaysOfWeekInput / formatDaysOfWeekForDisplay", () => {
  it("parses comma-separated text into a deduplicated, lowercased array", () => {
    expect(parseDaysOfWeekInput("sat, sun")).toEqual(["sat", "sun"]);
    expect(parseDaysOfWeekInput("Sat, Sat, SUN")).toEqual(["sat", "sun"]);
    expect(parseDaysOfWeekInput("")).toEqual([]);
  });

  it("formats an array back to a comma-separated display string", () => {
    expect(formatDaysOfWeekForDisplay(["sat", "sun"])).toBe("sat, sun");
    expect(formatDaysOfWeekForDisplay([])).toBe("");
  });
});

describe("isValidDateRange", () => {
  it("allows a null end date (open-ended batch)", () => {
    expect(isValidDateRange("2026-01-01", null)).toBe(true);
  });

  it("allows an end date on or after the start date", () => {
    expect(isValidDateRange("2026-01-01", "2026-01-01")).toBe(true);
    expect(isValidDateRange("2026-01-01", "2026-03-01")).toBe(true);
  });

  it("rejects an end date before the start date", () => {
    expect(isValidDateRange("2026-03-01", "2026-01-01")).toBe(false);
  });
});
