import { describe, expect, it } from "vitest";
import {
  INSTALLMENT_STATUSES,
  deriveInstallmentDisplayStatus,
  isInstallmentEditable,
  isInstallmentStatus,
} from "@/lib/domain/payment-plans";

describe("isInstallmentStatus", () => {
  it("accepts exactly the six CHECK-constraint values", () => {
    for (const status of INSTALLMENT_STATUSES) {
      expect(isInstallmentStatus(status)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isInstallmentStatus("Paid")).toBe(false);
    expect(isInstallmentStatus("cancelled")).toBe(false);
    expect(isInstallmentStatus(null)).toBe(false);
    expect(isInstallmentStatus(42)).toBe(false);
  });
});

describe("deriveInstallmentDisplayStatus", () => {
  it("returns 'waived' whenever the stored status is waived, regardless of due date or amount paid", () => {
    expect(
      deriveInstallmentDisplayStatus({
        status: "waived",
        dueDate: "2020-01-01",
        amountPaise: 10000,
        amountPaidPaise: 0,
        today: "2026-01-01",
      }),
    ).toBe("waived");
  });

  it("returns 'paid' when amount paid covers the full amount", () => {
    expect(
      deriveInstallmentDisplayStatus({
        status: "upcoming",
        dueDate: "2026-01-01",
        amountPaise: 10000,
        amountPaidPaise: 10000,
        today: "2026-01-01",
      }),
    ).toBe("paid");
  });

  it("returns 'partially_paid' when some but not all has been paid", () => {
    expect(
      deriveInstallmentDisplayStatus({
        status: "upcoming",
        dueDate: "2026-01-01",
        amountPaise: 10000,
        amountPaidPaise: 5000,
        today: "2026-01-01",
      }),
    ).toBe("partially_paid");
  });

  it("returns 'overdue' when unpaid and past due date", () => {
    expect(
      deriveInstallmentDisplayStatus({
        status: "upcoming",
        dueDate: "2025-01-01",
        amountPaise: 10000,
        amountPaidPaise: 0,
        today: "2026-01-01",
      }),
    ).toBe("overdue");
  });

  it("returns 'due' when unpaid and due today exactly", () => {
    expect(
      deriveInstallmentDisplayStatus({
        status: "upcoming",
        dueDate: "2026-01-01",
        amountPaise: 10000,
        amountPaidPaise: 0,
        today: "2026-01-01",
      }),
    ).toBe("due");
  });

  it("returns 'upcoming' when unpaid and due in the future", () => {
    expect(
      deriveInstallmentDisplayStatus({
        status: "upcoming",
        dueDate: "2027-01-01",
        amountPaise: 10000,
        amountPaidPaise: 0,
        today: "2026-01-01",
      }),
    ).toBe("upcoming");
  });

  it("a zero-amount installment is never reported as 'paid' even with zero paid", () => {
    // amountPaidPaise >= amountPaise (0 >= 0) would otherwise be a false
    // "paid" for a degenerate zero-amount row — the amountPaise > 0 guard
    // exists specifically for this.
    expect(
      deriveInstallmentDisplayStatus({
        status: "upcoming",
        dueDate: "2025-01-01",
        amountPaise: 0,
        amountPaidPaise: 0,
        today: "2026-01-01",
      }),
    ).toBe("overdue");
  });
});

describe("isInstallmentEditable", () => {
  it("is false only for 'paid'", () => {
    expect(isInstallmentEditable("paid")).toBe(false);
  });

  it("is true for every other status", () => {
    for (const status of INSTALLMENT_STATUSES) {
      if (status === "paid") continue;
      expect(isInstallmentEditable(status)).toBe(true);
    }
  });
});
