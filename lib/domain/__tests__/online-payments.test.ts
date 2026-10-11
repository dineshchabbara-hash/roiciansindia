import { describe, expect, it } from "vitest";
import {
  buildOnlinePaymentOptions,
  buildOrderReceipt,
  computeNextInstallmentDue,
  installmentDisplayName,
  isOnlinePaymentPurpose,
  type CoverageInstallment,
} from "@/lib/domain/online-payments";

const plan: CoverageInstallment[] = [
  { id: "i2", sequence: 2, label: null, amount: "600.00", storedStatus: "upcoming" },
  {
    id: "i1",
    sequence: 1,
    label: "Registration",
    amount: "400.00",
    storedStatus: "upcoming",
  },
  { id: "i3", sequence: 3, label: null, amount: "1000.50", storedStatus: "upcoming" },
];

describe("computeNextInstallmentDue — oldest-first coverage", () => {
  it("returns the first installment by sequence when nothing is paid", () => {
    expect(computeNextInstallmentDue(plan, 0, 200050)).toEqual({
      installmentId: "i1",
      sequence: 1,
      label: "Registration",
      amountPaise: 40000,
    });
  });

  it("charges only the uncovered remainder of a partly covered installment", () => {
    // 450.00 paid: installment 1 (400) covered, 50 towards installment 2 (600)
    expect(computeNextInstallmentDue(plan, 45000, 155050)).toMatchObject({
      installmentId: "i2",
      amountPaise: 55000,
    });
  });

  it("moves on once an installment is exactly covered", () => {
    expect(computeNextInstallmentDue(plan, 100000, 100050)).toMatchObject({
      installmentId: "i3",
      amountPaise: 100050,
    });
  });

  it("skips waived installments", () => {
    const waived = plan.map((i) =>
      i.id === "i1" ? { ...i, storedStatus: "waived" as const } : i,
    );
    expect(computeNextInstallmentDue(waived, 0, 160050)).toMatchObject({
      installmentId: "i2",
      amountPaise: 60000,
    });
  });

  it("caps the amount at the outstanding balance", () => {
    expect(computeNextInstallmentDue(plan, 0, 25000)).toMatchObject({
      installmentId: "i1",
      amountPaise: 25000,
    });
  });

  it("returns null when everything is covered, nothing is outstanding, or there is no plan", () => {
    expect(computeNextInstallmentDue(plan, 200050, 10000)).toBeNull();
    expect(computeNextInstallmentDue(plan, 0, 0)).toBeNull();
    expect(computeNextInstallmentDue([], 0, 50000)).toBeNull();
  });

  it("treats a net-negative paid figure as nothing paid", () => {
    expect(computeNextInstallmentDue(plan, -5000, 200050)).toMatchObject({
      installmentId: "i1",
    });
  });
});

describe("buildOnlinePaymentOptions", () => {
  it("offers the next installment and the full balance when they differ", () => {
    expect(
      buildOnlinePaymentOptions({
        outstandingPaise: 200050,
        nextInstallment: {
          installmentId: "i1",
          sequence: 1,
          label: "Registration",
          amountPaise: 40000,
        },
      }),
    ).toEqual([
      {
        purpose: "next_installment",
        amountPaise: 40000,
        installmentId: "i1",
        label: "Pay next installment (Registration)",
      },
      {
        purpose: "full_outstanding",
        amountPaise: 200050,
        installmentId: null,
        label: "Pay full outstanding balance",
      },
    ]);
  });

  it("offers only the full balance when the next installment equals it or there is no plan", () => {
    expect(
      buildOnlinePaymentOptions({
        outstandingPaise: 40000,
        nextInstallment: {
          installmentId: "i1",
          sequence: 1,
          label: null,
          amountPaise: 40000,
        },
      }).map((o) => o.purpose),
    ).toEqual(["full_outstanding"]);
    expect(
      buildOnlinePaymentOptions({ outstandingPaise: 5000, nextInstallment: null }).map(
        (o) => o.purpose,
      ),
    ).toEqual(["full_outstanding"]);
  });

  it("offers nothing when nothing is outstanding", () => {
    expect(
      buildOnlinePaymentOptions({ outstandingPaise: 0, nextInstallment: null }),
    ).toEqual([]);
  });
});

describe("helpers", () => {
  it("names installments by label or sequence", () => {
    expect(installmentDisplayName({ sequence: 2, label: null })).toBe("Installment 2");
    expect(installmentDisplayName({ sequence: 2, label: "  " })).toBe("Installment 2");
    expect(installmentDisplayName({ sequence: 1, label: "Registration" })).toBe(
      "Registration",
    );
  });

  it("recognises only the two purposes", () => {
    expect(isOnlinePaymentPurpose("full_outstanding")).toBe(true);
    expect(isOnlinePaymentPurpose("next_installment")).toBe(true);
    expect(isOnlinePaymentPurpose("custom_amount")).toBe(false);
  });

  it("builds a ≤40-char receipt from the enrollment code, without personal data", () => {
    const receipt = buildOrderReceipt(
      "ENR-000123",
      new Date("2026-10-11T00:00:00Z"),
      "a1b2c3",
    );
    expect(receipt.startsWith("ENR-000123-")).toBe(true);
    expect(receipt.length).toBeLessThanOrEqual(40);
  });
});
