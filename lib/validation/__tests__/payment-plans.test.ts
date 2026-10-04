import { describe, expect, it } from "vitest";
import {
  installmentLineSchema,
  createPaymentPlanSchema,
  parseCreatePaymentPlanFormData,
  parseInstallmentLineFormData,
} from "@/lib/validation/payment-plans";

describe("installmentLineSchema", () => {
  it("accepts a valid line", () => {
    const result = installmentLineSchema.safeParse({
      label: "Registration",
      amount: "10000.00",
      dueDate: "2026-01-15",
    });
    expect(result.success).toBe(true);
  });

  it("transforms a blank label to null", () => {
    const result = installmentLineSchema.safeParse({
      label: "",
      amount: "100",
      dueDate: "2026-01-15",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.label).toBeNull();
  });

  it("rejects a malformed amount", () => {
    expect(
      installmentLineSchema.safeParse({ amount: "abc", dueDate: "2026-01-15" }).success,
    ).toBe(false);
    expect(
      installmentLineSchema.safeParse({ amount: "-100", dueDate: "2026-01-15" }).success,
    ).toBe(false);
    expect(
      installmentLineSchema.safeParse({ amount: "100.999", dueDate: "2026-01-15" })
        .success,
    ).toBe(false);
  });

  it("rejects a malformed due date", () => {
    expect(
      installmentLineSchema.safeParse({ amount: "100", dueDate: "15-01-2026" }).success,
    ).toBe(false);
    expect(installmentLineSchema.safeParse({ amount: "100", dueDate: "" }).success).toBe(
      false,
    );
  });
});

describe("createPaymentPlanSchema", () => {
  it("rejects an empty installments array", () => {
    const result = createPaymentPlanSchema.safeParse({ installments: [] });
    expect(result.success).toBe(false);
  });

  it("accepts one or more valid lines", () => {
    const result = createPaymentPlanSchema.safeParse({
      installments: [
        { label: "Registration", amount: "10000.00", dueDate: "2026-01-01" },
        { label: "Installment 1", amount: "20000.00", dueDate: "2026-02-01" },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("parseCreatePaymentPlanFormData", () => {
  it("zips parallel label/amount/dueDate fields by submission order", () => {
    const formData = new FormData();
    formData.append("label", "Registration");
    formData.append("amount", "10000.00");
    formData.append("dueDate", "2026-01-01");
    formData.append("label", "Installment 1");
    formData.append("amount", "20000.00");
    formData.append("dueDate", "2026-02-01");

    const result = parseCreatePaymentPlanFormData(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.installments).toEqual([
        { label: "Registration", amount: "10000.00", dueDate: "2026-01-01" },
        { label: "Installment 1", amount: "20000.00", dueDate: "2026-02-01" },
      ]);
    }
  });

  it("fails with no rows at all", () => {
    const formData = new FormData();
    const result = parseCreatePaymentPlanFormData(formData);
    expect(result.success).toBe(false);
  });

  it("fails (does not silently drop) when one row has an invalid amount", () => {
    // Financial correctness over leniency — see this module's own comment:
    // silently dropping a bad row would surface a confusing "doesn't sum"
    // error instead of the real problem.
    const formData = new FormData();
    formData.append("label", "Registration");
    formData.append("amount", "10000.00");
    formData.append("dueDate", "2026-01-01");
    formData.append("label", "Installment 1");
    formData.append("amount", "not-a-number");
    formData.append("dueDate", "2026-02-01");

    const result = parseCreatePaymentPlanFormData(formData);
    expect(result.success).toBe(false);
  });
});

describe("parseInstallmentLineFormData", () => {
  it("parses a single add/edit row", () => {
    const formData = new FormData();
    formData.set("label", "Installment 2");
    formData.set("amount", "15000.50");
    formData.set("dueDate", "2026-03-01");

    const result = parseInstallmentLineFormData(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        label: "Installment 2",
        amount: "15000.50",
        dueDate: "2026-03-01",
      });
    }
  });

  it("fails on a missing amount", () => {
    const formData = new FormData();
    formData.set("dueDate", "2026-03-01");
    expect(parseInstallmentLineFormData(formData).success).toBe(false);
  });
});
