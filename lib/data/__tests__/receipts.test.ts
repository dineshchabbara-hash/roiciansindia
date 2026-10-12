import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/data/receipts.ts with its I/O boundaries mocked: the viewer's
 * RLS-scoped client, the service-role client, next/server's after() and
 * the PDF renderer. Database invariants (paid-only, one receipt per
 * payment, DB-side numbering, immutability, RLS, concurrency) are proven
 * in supabase/tests/phase21a_receipts_test.sql and
 * scripts/test-receipt-issuance-concurrency.sh.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/pdf/receipt", () => ({
  renderReceiptPdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-fake")),
}));

import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { renderReceiptPdf } from "@/lib/pdf/receipt";
import {
  ensureReceiptForPayment,
  getMyPaymentReceipts,
  getReceiptForPayment,
  getReceiptPdfForViewer,
  queueReceiptIssuance,
} from "@/lib/data/receipts";

const PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RECEIPT_ID = "rrrrrrrr-0000-4000-8000-000000000001";
const PDF_PATH = `student-1/${RECEIPT_ID}.pdf`;

type Result = { data?: unknown; error?: unknown };
type Call = { table: string; method: string; args: unknown[] };

/** Chainable PostgREST stand-in: each table resolves to a queue of results. */
function makeClient(options: {
  tables?: Record<string, Result[]>;
  rpc?: Record<string, Result>;
  storage?: { upload?: Result; download?: Result };
}) {
  const calls: Call[] = [];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const storageCalls: Array<{ bucket: string; method: string; args: unknown[] }> = [];
  const queues: Record<string, Result[]> = Object.fromEntries(
    Object.entries(options.tables ?? {}).map(([k, v]) => [k, [...v]]),
  );
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of [
        "select",
        "eq",
        "is",
        "order",
        "update",
        "maybeSingle",
        "single",
      ]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => {
        const next = queues[table]?.shift() ?? { data: null, error: null };
        return Promise.resolve({ data: null, error: null, ...next }).then(
          resolve,
          reject,
        );
      };
      return builder;
    },
    rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null, ...(options.rpc?.[fn] ?? {}) });
    },
    storage: {
      from(bucket: string) {
        return {
          upload: (...args: unknown[]) => {
            storageCalls.push({ bucket, method: "upload", args });
            return Promise.resolve({
              data: {},
              error: null,
              ...(options.storage?.upload ?? {}),
            });
          },
          download: (...args: unknown[]) => {
            storageCalls.push({ bucket, method: "download", args });
            return Promise.resolve({
              data: new Blob([new Uint8Array([37, 80, 68, 70])]),
              error: null,
              ...(options.storage?.download ?? {}),
            });
          },
        };
      },
    },
  };
  return { client, calls, rpcCalls, storageCalls };
}

const ISSUE_FRESH = {
  data: [
    {
      receipt_id: RECEIPT_ID,
      receipt_number: "REC-2026-000007",
      pdf_path: PDF_PATH,
      pdf_generated_at: null,
      already_issued: false,
    },
  ],
};

const SOURCE_TABLES = {
  receipts: [{ data: { created_at: "2026-10-12T04:30:00Z" } }, { data: null }],
  payments: [
    {
      data: {
        payment_code: "PAY-000101",
        paid_at: "2026-10-11T20:00:00Z",
        method: "cash",
        amount: 2500.5,
        tax_amount: 0,
        total_amount: 2500.5,
        internal_reference: "Book 4",
        razorpay_payment_id: null,
        student: { student_code: "10042", first_name: "Asha", last_name: "Verma" },
        enrollment: {
          enrollment_code: "ENR-000077",
          program: { name: "Data Analytics" },
          batch: { name: "Weekend A" },
        },
      },
    },
  ],
  company_settings: [
    {
      data: {
        legal_name: "Roicians Tech Pvt. Ltd.",
        address: null,
        phone: null,
        email: null,
        gstin: null,
        tax_label: "GST",
      },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ensureReceiptForPayment", () => {
  it("issues through the database, renders from trusted rows, uploads to the fixed path and marks it generated", async () => {
    const admin = makeClient({
      rpc: { issue_receipt: ISSUE_FRESH },
      tables: SOURCE_TABLES,
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);

    const result = await ensureReceiptForPayment(PAYMENT_ID);

    expect(result).toEqual({
      ok: true,
      data: {
        receiptId: RECEIPT_ID,
        receiptNumber: "REC-2026-000007",
        alreadyIssued: false,
        pdfReady: true,
      },
    });
    expect(admin.rpcCalls).toEqual([
      { fn: "issue_receipt", args: { p_payment_id: PAYMENT_ID } },
    ]);
    // The document is built from the database rows, amount to the paisa.
    const document = vi.mocked(renderReceiptPdf).mock.calls[0][0];
    expect(document.receiptNumber).toBe("REC-2026-000007");
    expect(document.totalAmount).toBe("INR 2,500.50");
    expect(document.receivedFrom).toContainEqual(["Student", "Asha Verma"]);
    expect(admin.storageCalls).toEqual([
      {
        bucket: "receipts",
        method: "upload",
        args: [
          PDF_PATH,
          expect.any(Buffer),
          { contentType: "application/pdf", upsert: true },
        ],
      },
    ]);
    const mark = admin.calls.filter(
      (c) => c.table === "receipts" && c.method !== "select",
    );
    expect(mark.map((c) => c.method)).toEqual(["eq", "single", "update", "eq", "is"]);
    expect(mark.find((c) => c.method === "is")?.args).toEqual(["pdf_generated_at", null]);
  });

  it("returns an already generated receipt without rendering or uploading again", async () => {
    const admin = makeClient({
      rpc: {
        issue_receipt: {
          data: [
            {
              ...ISSUE_FRESH.data[0],
              pdf_generated_at: "2026-10-12T04:31:00Z",
              already_issued: true,
            },
          ],
        },
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);

    const result = await ensureReceiptForPayment(PAYMENT_ID);

    expect(result).toMatchObject({
      ok: true,
      data: { alreadyIssued: true, pdfReady: true },
    });
    expect(renderReceiptPdf).not.toHaveBeenCalled();
    expect(admin.storageCalls).toEqual([]);
  });

  it("refuses a payment that is not paid and an unknown payment", async () => {
    const notPaid = makeClient({
      rpc: { issue_receipt: { error: { code: "P2101", message: "x" } } },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(notPaid.client as never);
    expect(await ensureReceiptForPayment(PAYMENT_ID)).toEqual({
      ok: false,
      error: "A receipt can only be issued for a paid payment.",
    });

    const unknown = makeClient({
      rpc: { issue_receipt: { error: { code: "P2104", message: "x" } } },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(unknown.client as never);
    expect(await ensureReceiptForPayment(PAYMENT_ID)).toEqual({
      ok: false,
      error: "Payment not found.",
    });
    expect(renderReceiptPdf).not.toHaveBeenCalled();
  });

  it("keeps the issued number when PDF generation fails (pending, retryable)", async () => {
    const admin = makeClient({
      rpc: { issue_receipt: ISSUE_FRESH },
      tables: SOURCE_TABLES,
      storage: { upload: { error: new Error("storage down") } },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);

    const result = await ensureReceiptForPayment(PAYMENT_ID);

    expect(result).toEqual({
      ok: true,
      data: {
        receiptId: RECEIPT_ID,
        receiptNumber: "REC-2026-000007",
        alreadyIssued: false,
        pdfReady: false,
      },
    });
    expect(admin.calls.some((c) => c.table === "receipts" && c.method === "update")).toBe(
      false,
    );
  });

  it("reports an unexpected database failure generically", async () => {
    const admin = makeClient({
      rpc: { issue_receipt: { error: { code: "XX000", message: "internal detail" } } },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);
    expect(await ensureReceiptForPayment(PAYMENT_ID)).toEqual({
      ok: false,
      error: "The receipt could not be issued. Please try again.",
    });
  });
});

describe("queueReceiptIssuance", () => {
  it("defers issuance until after the response", async () => {
    const admin = makeClient({
      rpc: {
        issue_receipt: {
          data: [{ ...ISSUE_FRESH.data[0], pdf_generated_at: "2026-10-12T04:31:00Z" }],
        },
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);

    queueReceiptIssuance(PAYMENT_ID);
    expect(admin.rpcCalls).toEqual([]);
    expect(after).toHaveBeenCalledTimes(1);

    const task = vi.mocked(after).mock.calls[0][0] as () => Promise<void>;
    await task();
    expect(admin.rpcCalls).toEqual([
      { fn: "issue_receipt", args: { p_payment_id: PAYMENT_ID } },
    ]);
  });
});

describe("viewer reads", () => {
  it("getReceiptForPayment maps the RLS-visible receipt", async () => {
    const viewer = makeClient({
      tables: {
        receipts: [
          {
            data: {
              id: RECEIPT_ID,
              receipt_number: "REC-2026-000007",
              created_at: "2026-10-12T04:30:00Z",
              pdf_generated_at: null,
            },
          },
        ],
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    expect(await getReceiptForPayment(PAYMENT_ID)).toEqual({
      ok: true,
      data: {
        id: RECEIPT_ID,
        receiptNumber: "REC-2026-000007",
        issuedAt: "2026-10-12T04:30:00Z",
        pdfGeneratedAt: null,
      },
    });
  });

  it("getMyPaymentReceipts lists only paid payments of the enrollment with their receipts", async () => {
    const viewer = makeClient({
      tables: {
        payments: [
          {
            data: [
              {
                id: PAYMENT_ID,
                payment_code: "PAY-000101",
                paid_at: "2026-10-11T20:00:00Z",
                total_amount: "2000.00",
                method: "razorpay",
                receipt: {
                  id: RECEIPT_ID,
                  receipt_number: "REC-2026-000007",
                  created_at: "2026-10-12T04:30:00Z",
                  pdf_generated_at: "2026-10-12T04:31:00Z",
                },
              },
              {
                id: "p2",
                payment_code: "PAY-000102",
                paid_at: null,
                total_amount: 500,
                method: "cash",
                receipt: [],
              },
            ],
          },
        ],
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);

    const result = await getMyPaymentReceipts("enr-1");

    expect(viewer.calls).toContainEqual({
      table: "payments",
      method: "eq",
      args: ["enrollment_id", "enr-1"],
    });
    expect(viewer.calls).toContainEqual({
      table: "payments",
      method: "eq",
      args: ["status", "paid"],
    });
    expect(result).toEqual({
      ok: true,
      data: [
        {
          paymentId: PAYMENT_ID,
          paymentCode: "PAY-000101",
          paidAt: "2026-10-11T20:00:00Z",
          amountPaise: 200000,
          method: "razorpay",
          receipt: {
            id: RECEIPT_ID,
            receiptNumber: "REC-2026-000007",
            issuedAt: "2026-10-12T04:30:00Z",
            pdfGeneratedAt: "2026-10-12T04:31:00Z",
          },
        },
        {
          paymentId: "p2",
          paymentCode: "PAY-000102",
          paidAt: null,
          amountPaise: 50000,
          method: "cash",
          receipt: null,
        },
      ],
    });
  });
});

describe("getReceiptPdfForViewer", () => {
  it("answers a payment the viewer cannot see exactly like an unknown one", async () => {
    const viewer = makeClient({ tables: { payments: [{ data: null }] } });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);

    expect(await getReceiptPdfForViewer(PAYMENT_ID)).toEqual({
      ok: false,
      reason: "not_found",
      error: "Receipt not found.",
    });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("offers nothing for a payment that is not paid", async () => {
    const viewer = makeClient({
      tables: { payments: [{ data: { id: PAYMENT_ID, status: "authorized" } }] },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);

    expect(await getReceiptPdfForViewer(PAYMENT_ID)).toMatchObject({
      ok: false,
      reason: "not_eligible",
    });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("streams a ready receipt through the viewer's own session without re-issuing", async () => {
    const viewer = makeClient({
      tables: {
        payments: [{ data: { id: PAYMENT_ID, status: "paid" } }],
        receipts: [
          {
            data: {
              receipt_number: "REC-2026-000007",
              pdf_path: PDF_PATH,
              pdf_generated_at: "2026-10-12T04:31:00Z",
            },
          },
        ],
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);

    const result = await getReceiptPdfForViewer(PAYMENT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.fileName).toBe("REC-2026-000007.pdf");
    expect(Array.from(result.data.bytes)).toEqual([37, 80, 68, 70]);
    expect(viewer.storageCalls).toEqual([
      { bucket: "receipts", method: "download", args: [PDF_PATH] },
    ]);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("issues and generates on demand when the receipt is missing, then reads it back as the viewer", async () => {
    const viewer = makeClient({
      tables: {
        payments: [{ data: { id: PAYMENT_ID, status: "paid" } }],
        receipts: [
          { data: null },
          {
            data: {
              receipt_number: "REC-2026-000007",
              pdf_path: PDF_PATH,
              pdf_generated_at: "2026-10-12T04:31:00Z",
            },
          },
        ],
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    const admin = makeClient({
      rpc: { issue_receipt: ISSUE_FRESH },
      tables: SOURCE_TABLES,
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);

    const result = await getReceiptPdfForViewer(PAYMENT_ID);

    expect(result.ok).toBe(true);
    expect(admin.rpcCalls).toHaveLength(1);
    expect(admin.storageCalls.map((c) => c.method)).toEqual(["upload"]);
    expect(viewer.storageCalls.map((c) => c.method)).toEqual(["download"]);
  });

  it("reports a pending PDF when generation is still failing", async () => {
    const viewer = makeClient({
      tables: {
        payments: [{ data: { id: PAYMENT_ID, status: "paid" } }],
        receipts: [{ data: null }],
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    const admin = makeClient({
      rpc: { issue_receipt: ISSUE_FRESH },
      tables: SOURCE_TABLES,
      storage: { upload: { error: new Error("storage down") } },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);

    expect(await getReceiptPdfForViewer(PAYMENT_ID)).toEqual({
      ok: false,
      reason: "pending",
      error: "The receipt is being prepared. Please try again shortly.",
    });
    expect(viewer.storageCalls).toEqual([]);
  });

  it("fails closed when the viewer's storage read is refused", async () => {
    const viewer = makeClient({
      tables: {
        payments: [{ data: { id: PAYMENT_ID, status: "paid" } }],
        receipts: [
          {
            data: {
              receipt_number: "REC-2026-000007",
              pdf_path: PDF_PATH,
              pdf_generated_at: "2026-10-12T04:31:00Z",
            },
          },
        ],
      },
      storage: { download: { data: null, error: new Error("Object not found") } },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);

    expect(await getReceiptPdfForViewer(PAYMENT_ID)).toMatchObject({
      ok: false,
      reason: "error",
    });
  });
});
