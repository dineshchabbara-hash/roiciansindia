import { describe, expect, it } from "vitest";
import { redactForAudit } from "@/lib/domain/audit";

describe("redactForAudit", () => {
  it("strips keys that look like credentials", () => {
    const result = redactForAudit({
      password: "hunter2",
      encrypted_password: "abc",
      token: "xyz",
      api_key: "k",
      secret: "s",
      studentCode: "10001",
    });
    expect(result).toEqual({ studentCode: "10001" });
  });

  it("passes through everything else unchanged", () => {
    const result = redactForAudit({ before: "active", after: "inactive" });
    expect(result).toEqual({ before: "active", after: "inactive" });
  });

  it("handles null and undefined", () => {
    expect(redactForAudit(null)).toBeNull();
    expect(redactForAudit(undefined)).toBeUndefined();
  });

  it("handles an empty object", () => {
    expect(redactForAudit({})).toEqual({});
  });
});
