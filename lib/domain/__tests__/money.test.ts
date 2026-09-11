import { describe, expect, it } from "vitest";
import {
  toPaise,
  sumPaise,
  paiseToRupees,
  formatPaiseAsINR,
  formatDecimalAsINR,
} from "@/lib/domain/money";

describe("toPaise", () => {
  it("converts a numeric string to integer paise", () => {
    expect(toPaise("20000.00")).toBe(2000000);
    expect(toPaise("199.99")).toBe(19999);
  });

  it("treats null/undefined as zero", () => {
    expect(toPaise(null)).toBe(0);
    expect(toPaise(undefined)).toBe(0);
  });

  it("never returns NaN for garbage input", () => {
    expect(toPaise("not-a-number")).toBe(0);
  });
});

describe("sumPaise", () => {
  it("sums Postgres numeric strings without floating-point drift", () => {
    // The classic 0.1 + 0.2 !== 0.3 float trap, at currency precision.
    expect(sumPaise(["0.10", "0.20"])).toBe(30);
  });

  it("sums a realistic set of payment amounts exactly", () => {
    expect(sumPaise(["20000.00", "20000.00", "10000.00"])).toBe(5000000);
  });

  it("returns 0 for an empty list", () => {
    expect(sumPaise([])).toBe(0);
  });
});

describe("paiseToRupees / formatPaiseAsINR", () => {
  it("converts paise back to rupees", () => {
    expect(paiseToRupees(2000000)).toBe(20000);
  });

  it("formats as a whole-rupee INR string", () => {
    expect(formatPaiseAsINR(0)).toMatch(/₹0|₹\s?0/);
    expect(formatPaiseAsINR(2000000)).toContain("20,000");
  });
});

// Regression coverage for a real Phase 7 bug: Program fees (numeric(12,2),
// which genuinely holds cents, unlike whole-rupee payment amounts) were
// displayed via formatPaiseAsINR's maximumFractionDigits:0 formatter,
// silently rounding "500.50" up to "₹501". Traced end to end: the stored
// DB value and every step up to display (input, Zod, FormData, insert/
// update payload) were already exact — only the display formatter was
// wrong. formatDecimalAsINR is a separate, string-only formatter that
// exists specifically so a field that can hold cents is never routed
// through the whole-rupee one.
describe("formatDecimalAsINR", () => {
  it("preserves exact cents for every value from the bug report", () => {
    expect(formatDecimalAsINR("50000.50")).toBe("₹50,000.50");
    expect(formatDecimalAsINR("500.50")).toBe("₹500.50");
    expect(formatDecimalAsINR("50000.99")).toBe("₹50,000.99");
    expect(formatDecimalAsINR("0.50")).toBe("₹0.50");
  });

  it("pads a whole-number value to exactly 2 decimal places", () => {
    expect(formatDecimalAsINR("50000")).toBe("₹50,000.00");
  });

  it("pads a single-decimal-digit value to 2 places without rounding", () => {
    expect(formatDecimalAsINR("500.5")).toBe("₹500.50");
  });

  it("applies Indian-style lakh/crore digit grouping without touching the decimal part", () => {
    expect(formatDecimalAsINR("1234567.05")).toBe("₹12,34,567.05");
  });

  it("falls back to ₹0.00 for null, undefined, empty, or malformed input rather than crashing", () => {
    expect(formatDecimalAsINR(null)).toBe("₹0.00");
    expect(formatDecimalAsINR(undefined)).toBe("₹0.00");
    expect(formatDecimalAsINR("")).toBe("₹0.00");
    expect(formatDecimalAsINR("not-a-number")).toBe("₹0.00");
  });

  it("never involves Number()/parseFloat at all, unlike toPaise/formatPaiseAsINR", () => {
    // The reported bug's exact repro: formatPaiseAsINR(toPaise("500.50"))
    // rounds to "₹501" purely because of that formatter's
    // maximumFractionDigits: 0 — not because toPaise itself lost precision
    // (toPaise("500.50") is exactly 50050 paise). formatDecimalAsINR
    // sidesteps the whole numeric round-trip: it is pure string
    // manipulation from end to end, so there is no float step for a future
    // change to accidentally reintroduce.
    expect(toPaise("500.50")).toBe(50050);
    expect(formatPaiseAsINR(toPaise("500.50"))).toBe("₹501");
    expect(formatDecimalAsINR("500.50")).toBe("₹500.50");
  });
});
