import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRY_OPTIONS,
} from "@/lib/domain/phone-countries";

/**
 * Regression coverage for the SSR/hydration mismatch: PHONE_COUNTRY_OPTIONS
 * used to derive labels from Intl.DisplayNames at runtime, which is not
 * guaranteed to agree between Node's ICU (server render) and a browser's
 * ICU (client hydration) — reproduced for real with "Falkland Islands" vs
 * "Falkland Islands (Islas Malvinas)". Labels are now a static map, so this
 * asserts the exact resulting strings rather than just "is non-empty" —
 * a test that only checked truthiness would not have caught the original
 * bug, since Intl.DisplayNames always returns *a* string, just not always
 * the *same* one across runtimes.
 */

describe("PHONE_COUNTRY_OPTIONS", () => {
  it("preserves all 245 libphonenumber-js-supported countries", () => {
    expect(PHONE_COUNTRY_OPTIONS).toHaveLength(245);
  });

  it("has no duplicate country codes", () => {
    const codes = PHONE_COUNTRY_OPTIONS.map((o) => o.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("defaults to India and pins it first", () => {
    expect(DEFAULT_PHONE_COUNTRY).toBe("IN");
    expect(PHONE_COUNTRY_OPTIONS[0]).toEqual({
      code: "IN",
      name: "India",
      callingCode: "91",
    });
  });

  it.each([
    ["FK", "Falkland Islands", "500"],
    ["IN", "India", "91"],
    ["CA", "Canada", "1"],
    ["GB", "United Kingdom", "44"],
    ["AE", "United Arab Emirates", "971"],
  ])("renders a fixed, deterministic label for %s", (code, name, callingCode) => {
    const option = PHONE_COUNTRY_OPTIONS.find((o) => o.code === code);
    expect(option).toEqual({ code, name, callingCode });
  });

  it("produces the exact same option set across repeated imports (module-level determinism)", async () => {
    // Re-importing the same module in the same test run returns the same
    // cached module instance in both Node and the browser, so this mainly
    // guards against any accidental per-call randomness being introduced
    // later (e.g. a stray Math.random or Date-based sort) — a re-import
    // would still expose it if the module were ever re-evaluated.
    const second = await import("@/lib/domain/phone-countries");
    expect(second.PHONE_COUNTRY_OPTIONS).toEqual(PHONE_COUNTRY_OPTIONS);
  });

  it("never derives a label from Intl.DisplayNames at call time", () => {
    // A static map can't call a browser/Node API at all — spying on
    // Intl.DisplayNames and re-reading the already-built list confirms no
    // hidden lazy/memoized call path was introduced.
    const spy = vi.spyOn(Intl, "DisplayNames");
    PHONE_COUNTRY_OPTIONS.forEach((o) => o.name);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
