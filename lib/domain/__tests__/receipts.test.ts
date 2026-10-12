import { describe, expect, it } from "vitest";
import {
  buildReceiptDocument,
  canDownloadReceipt,
  formatDocumentAmount,
  formatDocumentDate,
  isReceiptEligible,
  receiptDownloadHref,
  receiptFileName,
  resolveReceiptState,
  type ReceiptSourceRow,
} from "@/lib/domain/receipts";

const PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function source(overrides: Partial<ReceiptSourceRow["payment"]> = {}): ReceiptSourceRow {
  return {
    receiptNumber: "REC-2026-000042",
    issuedAt: "2026-10-12T04:30:00Z",
    payment: {
      paymentCode: "PAY-000101",
      paidAt: "2026-10-11T20:00:00Z", // 12 Oct 01:30 IST
      method: "cash",
      amountPaise: 250050,
      taxAmountPaise: 0,
      totalPaise: 250050,
      internalReference: "Receipt book 4 / 17",
      providerPaymentId: null,
      ...overrides,
    },
    student: { studentCode: "10042", firstName: "Asha", lastName: "Verma" },
    enrollment: {
      enrollmentCode: "ENR-000077",
      programName: "Data Analytics",
      batchName: "Weekend Batch A",
    },
    company: {
      legalName: "Roicians Tech Pvt. Ltd.",
      address: "12 MG Road\nBengaluru 560001",
      phone: "+91 80000 00000",
      email: "accounts@example.test",
      gstin: null,
      taxLabel: "GST",
    },
  };
}

describe("receipt eligibility and state", () => {
  it("only a paid payment qualifies", () => {
    expect(isReceiptEligible("paid")).toBe(true);
    for (const status of [
      "pending",
      "authorized",
      "failed",
      "cancelled",
      "refunded",
      "partially_refunded",
    ]) {
      expect(isReceiptEligible(status)).toBe(false);
      expect(canDownloadReceipt(status)).toBe(false);
    }
    expect(canDownloadReceipt("paid")).toBe(true);
  });

  it("resolves the lifecycle state", () => {
    expect(resolveReceiptState({ paymentStatus: "authorized", receipt: null })).toBe(
      "not_eligible",
    );
    expect(resolveReceiptState({ paymentStatus: "paid", receipt: null })).toBe(
      "not_issued",
    );
    expect(
      resolveReceiptState({ paymentStatus: "paid", receipt: { pdfGeneratedAt: null } }),
    ).toBe("pdf_pending");
    expect(
      resolveReceiptState({
        paymentStatus: "paid",
        receipt: { pdfGeneratedAt: "2026-10-12T04:31:00Z" },
      }),
    ).toBe("ready");
    // A receipt already issued stays visible whatever the payment's later status.
    expect(
      resolveReceiptState({
        paymentStatus: "refunded",
        receipt: { pdfGeneratedAt: "2026-10-12T04:31:00Z" },
      }),
    ).toBe("ready");
  });

  it("download link is the same-origin route keyed by payment id, never a storage path", () => {
    expect(receiptDownloadHref(PAYMENT_ID)).toBe(`/api/payments/${PAYMENT_ID}/receipt`);
    expect(receiptFileName("REC-2026-000042")).toBe("REC-2026-000042.pdf");
    expect(receiptFileName('RCPT/2026/"x"')).toBe("RCPT-2026-x-.pdf");
  });
});

describe("document formatting", () => {
  it("prints exact INR amounts with Indian grouping and no rupee glyph", () => {
    expect(formatDocumentAmount(250050)).toBe("INR 2,500.50");
    expect(formatDocumentAmount(10000000)).toBe("INR 1,00,000.00");
    expect(formatDocumentAmount(1)).toBe("INR 0.01");
  });

  it("prints Asia/Kolkata calendar dates", () => {
    expect(formatDocumentDate("2026-10-11T20:00:00Z")).toBe("12 Oct 2026");
    expect(formatDocumentDate(null)).toBe("—");
    expect(formatDocumentDate("not a date")).toBe("—");
  });
});

describe("buildReceiptDocument", () => {
  it("maps an offline payment from trusted rows", () => {
    const doc = buildReceiptDocument(source());
    expect(doc.receiptNumber).toBe("REC-2026-000042");
    expect(doc.receiptDate).toBe("12 Oct 2026");
    expect(doc.company).toEqual({
      legalName: "Roicians Tech Pvt. Ltd.",
      addressLines: ["12 MG Road", "Bengaluru 560001"],
      contactLine: "+91 80000 00000 · accounts@example.test",
      gstin: null,
    });
    expect(doc.receivedFrom).toEqual([
      ["Student", "Asha Verma"],
      ["Student ID", "10042"],
      ["Enrollment", "ENR-000077"],
      ["Program", "Data Analytics"],
      ["Batch", "Weekend Batch A"],
    ]);
    expect(doc.paymentDetails).toEqual([
      ["Payment ID", "PAY-000101"],
      ["Payment date", "12 Oct 2026"],
      ["Payment source", "Offline"],
      ["Payment method", "Cash"],
      ["Reference", "Receipt book 4 / 17"],
    ]);
    // Tax disabled: no tax line, the canonical total only.
    expect(doc.amounts).toEqual([]);
    expect(doc.totalAmount).toBe("INR 2,500.50");
    expect(doc.currency).toBe("INR");
  });

  it("maps a Razorpay payment with the same template and its provider payment id", () => {
    const doc = buildReceiptDocument(
      source({
        method: "razorpay",
        internalReference: null,
        providerPaymentId: "pay_TEST123",
      }),
    );
    expect(doc.paymentDetails).toEqual([
      ["Payment ID", "PAY-000101"],
      ["Payment date", "12 Oct 2026"],
      ["Payment source", "Online (Razorpay)"],
      ["Payment method", "Razorpay"],
      ["Razorpay payment ID", "pay_TEST123"],
    ]);
    expect(doc.totalAmount).toBe("INR 2,500.50");
  });

  it("never prints an offline reference on an online receipt or vice versa", () => {
    const online = buildReceiptDocument(
      source({ method: "razorpay", internalReference: "x", providerPaymentId: null }),
    );
    expect(online.paymentDetails.map(([label]) => label)).not.toContain("Reference");
    const offline = buildReceiptDocument(source({ providerPaymentId: "pay_X" }));
    expect(offline.paymentDetails.map(([label]) => label)).not.toContain(
      "Razorpay payment ID",
    );
  });

  it("prints a tax line only when the ledger row carries tax, using its own figures", () => {
    const doc = buildReceiptDocument(
      source({ amountPaise: 100000, taxAmountPaise: 18000, totalPaise: 118000 }),
    );
    expect(doc.amounts).toEqual([
      ["Amount", "INR 1,000.00"],
      ["GST", "INR 180.00"],
    ]);
    expect(doc.totalAmount).toBe("INR 1,180.00");
  });

  it("shows GSTIN only when configured and tolerates missing contact details", () => {
    const base = source();
    const doc = buildReceiptDocument({
      ...base,
      company: {
        ...base.company,
        gstin: " 29ABCDE1234F1Z5 ",
        address: null,
        phone: null,
        email: "  ",
      },
      enrollment: { ...base.enrollment, batchName: null },
    });
    expect(doc.company.gstin).toBe("29ABCDE1234F1Z5");
    expect(doc.company.addressLines).toEqual([]);
    expect(doc.company.contactLine).toBeNull();
    expect(doc.receivedFrom).toContainEqual(["Batch", "—"]);
  });
});
