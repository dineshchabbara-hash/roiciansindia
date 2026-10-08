import { describe, expect, it } from "vitest";
import { needsRebuild } from "../e2e-webserver-provenance.mjs";

describe("needsRebuild", () => {
  it("rebuilds when no build output exists at all", () => {
    expect(
      needsRebuild({ buildIdExists: false, storedHead: null, currentHead: "abc123" }),
    ).toBe(true);
  });

  it("rebuilds when a build exists but has no provenance marker", () => {
    expect(
      needsRebuild({ buildIdExists: true, storedHead: null, currentHead: "abc123" }),
    ).toBe(true);
  });

  it("rebuilds when the stored marker names a different commit (stale .next after a pull)", () => {
    expect(
      needsRebuild({ buildIdExists: true, storedHead: "old111", currentHead: "new222" }),
    ).toBe(true);
  });

  it("reuses the build when the marker matches the current commit exactly", () => {
    expect(
      needsRebuild({ buildIdExists: true, storedHead: "abc123", currentHead: "abc123" }),
    ).toBe(false);
  });

  it("rebuilds even with a matching marker if BUILD_ID itself is missing (incomplete build)", () => {
    expect(
      needsRebuild({ buildIdExists: false, storedHead: "abc123", currentHead: "abc123" }),
    ).toBe(true);
  });
});
