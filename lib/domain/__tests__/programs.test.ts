import { describe, expect, it } from "vitest";
import {
  DELIVERY_MODES,
  DURATION_UNITS,
  isDeliveryMode,
  isDurationUnit,
  isProgramStatus,
  isValidRegexPattern,
  matchesProgramCodePattern,
  PROGRAM_STATUSES,
} from "@/lib/domain/programs";

describe("isProgramStatus", () => {
  it("accepts exactly the 4 values the programs.status CHECK constraint allows", () => {
    for (const status of PROGRAM_STATUSES) {
      expect(isProgramStatus(status)).toBe(true);
    }
  });

  it("rejects values the schema does not support", () => {
    // 'suspended' would be a plausible-looking status for a human to guess,
    // but the DB CHECK constraint only allows draft/active/inactive/archived.
    expect(isProgramStatus("suspended")).toBe(false);
    expect(isProgramStatus("")).toBe(false);
    expect(isProgramStatus(null)).toBe(false);
    expect(isProgramStatus(undefined)).toBe(false);
  });
});

describe("isDurationUnit / isDeliveryMode", () => {
  it("accepts exactly the schema-supported duration units", () => {
    for (const unit of DURATION_UNITS) {
      expect(isDurationUnit(unit)).toBe(true);
    }
    expect(isDurationUnit("years")).toBe(false);
  });

  it("accepts exactly the schema-supported delivery modes", () => {
    for (const mode of DELIVERY_MODES) {
      expect(isDeliveryMode(mode)).toBe(true);
    }
    expect(isDeliveryMode("remote")).toBe(false);
  });
});

describe("isValidRegexPattern / matchesProgramCodePattern", () => {
  it("treats a well-formed pattern as valid and matches/rejects codes accordingly", () => {
    const pattern = "^[A-Z]{2,4}-\\d{3,4}$";
    expect(isValidRegexPattern(pattern)).toBe(true);
    expect(matchesProgramCodePattern("FSD-101", pattern)).toBe(true);
    expect(matchesProgramCodePattern("fsd-101", pattern)).toBe(false);
    expect(matchesProgramCodePattern("not-a-code", pattern)).toBe(false);
  });

  it("never throws on malformed regex — treated as invalid, not a crash", () => {
    // An unbalanced group is invalid regex syntax; an admin could plausibly
    // save something like this by hand while company_settings.program_code_pattern
    // has no format validation of its own yet.
    const malformed = "([A-Z";
    expect(isValidRegexPattern(malformed)).toBe(false);
    expect(() => new RegExp(malformed)).toThrow();
  });
});
