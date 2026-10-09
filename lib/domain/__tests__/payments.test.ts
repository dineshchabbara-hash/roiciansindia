import { describe, expect, it } from "vitest";
import {
  OFFLINE_PAYMENT_METHODS,
  OFFLINE_PAYMENT_TYPES,
  PAYMENT_ELIGIBLE_ENROLLMENT_STATUSES,
  canReceiveOfflinePayment,
  isAllowedPaymentDate,
  istDayStartUtc,
  istToday,
  nextIsoDate,
  normalizeEnrollmentCode,
  parsePaymentLedgerFilters,
  paymentLedgerFiltersToParams,
  paymentMethodLabel,
  paymentStatusLabel,
  paymentTypeLabel,
  rupeeStringToPaise,
} from "@/lib/domain/payments";
import { ENROLLMENT_STATUSES } from "@/lib/domain/enrollments";

describe("offline value sets (mirror record_offline_payment)", () => {
  it("offers BR-6's offline methods only — never razorpay or other", () => {
    expect([...OFFLINE_PAYMENT_METHODS].sort()).toEqual(
      ["bank_transfer", "cash", "cheque", "upi"].sort(),
    );
  });

  it("holds back the installment type (no installment allocation in 20A)", () => {
    expect([...OFFLINE_PAYMENT_TYPES].sort()).toEqual(
      ["full", "other", "partial", "registration"].sort(),
    );
  });

  it("labels every stored value and passes unknown values through", () => {
    expect(paymentMethodLabel("bank_transfer")).toBe("Bank transfer");
    expect(paymentMethodLabel("razorpay")).toBe("Razorpay (online)");
    expect(paymentTypeLabel("registration")).toBe("Registration fee");
    expect(paymentStatusLabel("partially_refunded")).toBe("Partially refunded");
    expect(paymentStatusLabel("mystery")).toBe("mystery");
  });
});

describe("enrollment eligibility (Phase 14 confirmed set)", () => {
  it("allows exactly enrolled / active / on_hold / completed", () => {
    expect([...PAYMENT_ELIGIBLE_ENROLLMENT_STATUSES]).toEqual([
      "enrolled",
      "active",
      "on_hold",
      "completed",
    ]);
    const allowed = ENROLLMENT_STATUSES.filter(canReceiveOfflinePayment);
    expect(allowed).toEqual(["enrolled", "active", "on_hold", "completed"]);
  });
});

describe("rupeeStringToPaise — exact, never parseFloat", () => {
  it.each([
    ["250.50", 25050],
    ["250.5", 25050],
    ["0.29", 29],
    ["0.01", 1],
    ["100", 10000],
    [" 42.07 ", 4207],
    ["9999999999.99", 999999999999],
  ])("%j -> %d paise", (input, expected) => {
    expect(rupeeStringToPaise(input)).toBe(expected);
  });

  it.each(["", "abc", "1.005", "-1", "1,000", "1e3", "12.", ".5", "12345678901"])(
    "rejects %j",
    (input) => {
      expect(rupeeStringToPaise(input)).toBeNull();
    },
  );
});

describe("Asia/Kolkata dates", () => {
  it("rolls the business day at 18:30 UTC", () => {
    expect(istToday(new Date("2026-10-09T18:29:59Z"))).toBe("2026-10-09");
    expect(istToday(new Date("2026-10-09T18:30:00Z"))).toBe("2026-10-10");
  });

  it("allows today and the past, never tomorrow or an invalid date", () => {
    const now = new Date("2026-10-09T10:00:00Z");
    expect(isAllowedPaymentDate("2026-10-09", now)).toBe(true);
    expect(isAllowedPaymentDate("2025-01-31", now)).toBe(true);
    expect(isAllowedPaymentDate("2026-10-10", now)).toBe(false);
    expect(isAllowedPaymentDate("2026-02-30", now)).toBe(false);
    expect(isAllowedPaymentDate("09-10-2026", now)).toBe(false);
  });

  it("maps an IST day to its UTC start and steps across month/year ends", () => {
    expect(istDayStartUtc("2026-10-09")).toBe("2026-10-08T18:30:00.000Z");
    expect(nextIsoDate("2026-10-31")).toBe("2026-11-01");
    expect(nextIsoDate("2026-12-31")).toBe("2027-01-01");
    expect(nextIsoDate("2028-02-28")).toBe("2028-02-29");
  });
});

describe("parsePaymentLedgerFilters", () => {
  it("defaults to no filters, page 1", () => {
    expect(parsePaymentLedgerFilters({})).toEqual({
      q: "",
      method: null,
      status: null,
      from: null,
      to: null,
      page: 1,
    });
  });

  it("keeps whitelisted values and drops everything else", () => {
    expect(
      parsePaymentLedgerFilters({
        q: "PAY-000001",
        method: "upi",
        status: "paid",
        from: "2026-10-01",
        to: "2026-10-09",
        page: "3",
      }),
    ).toEqual({
      q: "PAY-000001",
      method: "upi",
      status: "paid",
      from: "2026-10-01",
      to: "2026-10-09",
      page: 3,
    });
    expect(
      parsePaymentLedgerFilters({
        method: "bitcoin",
        status: "paid;drop",
        from: "2026-13-01",
        to: "yesterday",
        page: "-2",
      }),
    ).toMatchObject({ method: null, status: null, from: null, to: null, page: 1 });
  });

  it("sanitizes search text so it cannot alter the PostgREST or=() grammar", () => {
    expect(parsePaymentLedgerFilters({ q: "a,b),status.eq.x%*" }).q).toBe(
      "abstatus.eq.x",
    );
  });

  it("round-trips to URL params without page", () => {
    const filters = parsePaymentLedgerFilters({ q: "x", method: "cash", page: "2" });
    expect(paymentLedgerFiltersToParams(filters)).toEqual({
      q: "x",
      method: "cash",
      status: undefined,
      from: undefined,
      to: undefined,
    });
  });
});

describe("normalizeEnrollmentCode", () => {
  it("uppercases and trims a plausible code", () => {
    expect(normalizeEnrollmentCode("  enr-000012 ")).toBe("ENR-000012");
  });

  it.each(["", "ENR 0001", "ENR,1", "%", "x".repeat(41)])("rejects %j", (input) => {
    expect(normalizeEnrollmentCode(input)).toBeNull();
  });
});
