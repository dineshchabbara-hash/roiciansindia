// @vitest-environment node
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderReceiptPdf } from "@/lib/pdf/receipt";
import { buildReceiptDocument, type ReceiptSourceRow } from "@/lib/domain/receipts";

/**
 * Renders a REAL receipt PDF and reads its text back: every content
 * stream is inflated (or read as-is when uncompressed) and the hex-encoded text runs of each TJ/Tj operator
 * are decoded (the standard Helvetica fonts use single-byte WinAnsi
 * codes). Proves what a receipt prints — and what it never prints.
 */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const lines: string[] = [];
  const streamPattern = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const body = raw.slice(start, end);
    let content: string;
    try {
      content = inflateSync(Buffer.from(body, "latin1")).toString("latin1");
    } catch {
      content = body; // an uncompressed stream
    }
    for (const op of content.matchAll(/\[(.*?)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
      const hexRuns =
        op[1] !== undefined
          ? [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1])
          : [op[2]];
      lines.push(
        hexRuns.map((hex) => Buffer.from(hex, "hex").toString("latin1")).join(""),
      );
    }
  }
  // react-pdf splits one visual line into several text operators; joined
  // without separators the printed words read back in order.
  return lines.join("");
}

const SOURCE: ReceiptSourceRow = {
  receiptNumber: "REC-2026-000042",
  issuedAt: "2026-10-12T04:30:00Z",
  payment: {
    paymentCode: "PAY-000101",
    paidAt: "2026-10-11T20:00:00Z",
    method: "razorpay",
    amountPaise: 200000,
    taxAmountPaise: 0,
    totalPaise: 200000,
    internalReference: null,
    providerPaymentId: "pay_TEST123",
  },
  student: { studentCode: "10042", firstName: "Asha", lastName: "Verma" },
  enrollment: {
    enrollmentCode: "ENR-000077",
    programName: "Data Analytics",
    batchName: "Weekend Batch A",
  },
  company: {
    legalName: "Roicians Tech Pvt. Ltd.",
    address: "12 MG Road",
    phone: null,
    email: "accounts@example.test",
    gstin: null,
    taxLabel: "GST",
  },
};

describe("renderReceiptPdf", () => {
  it("renders a PDF that prints the receipt fields from the document", async () => {
    const pdf = await renderReceiptPdf(buildReceiptDocument(SOURCE));
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = pdfText(pdf);
    for (const expected of [
      "Roicians Tech Pvt. Ltd.",
      "Payment Receipt",
      "Receipt No. REC-2026-000042",
      "Receipt date: 12 Oct 2026",
      "Asha Verma",
      "10042",
      "ENR-000077",
      "Data Analytics",
      "Weekend Batch A",
      "PAY-000101",
      "Online (Razorpay)",
      "pay_TEST123",
      "Amount received",
      "INR 2,000.00",
    ]) {
      expect(text).toContain(expected);
    }
    // Tax disabled: no tax line and no GSTIN line.
    expect(text).not.toContain("GSTIN");
    expect(text).not.toMatch(/\bGST\b/);
  }, 30_000);

  it("never prints internal identifiers, storage paths or secrets", async () => {
    const pdf = await renderReceiptPdf(buildReceiptDocument(SOURCE));
    const text = pdfText(pdf);
    const raw = pdf.toString("latin1");
    for (const haystack of [text, raw]) {
      expect(haystack).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      expect(haystack).not.toMatch(
        /order_|rzp_|\.pdf|razorpay_signature|service_role|secret|auth_user/i,
      );
    }
  }, 30_000);
});
