import { describe, expect, it } from "vitest";
import { toPaise, sumPaise, paiseToRupees, formatPaiseAsINR } from "@/lib/domain/money";

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
