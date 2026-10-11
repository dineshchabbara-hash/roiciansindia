import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 14 / Phase 19 regression for Phase 20B: a Razorpay payment
 * finalized into the canonical ledger is just a `payments` row with
 * status 'paid' and total_amount = amount — the same shape as an offline
 * payment. This proves both engines read it exactly like an equivalent
 * offline payment, and that they only ever ask for status 'paid' (so a
 * held 'authorized' Razorpay row can never count). No formula changed.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getEnrollmentFinancialSummary } from "@/lib/data/enrollments";
import { getReportPage } from "@/lib/data/reports";
import { parseReportFilters } from "@/lib/domain/reports";

type Call = { method: string; args: unknown[] };
type Query = { table: string; calls: Call[] };

function makeClient(results: Array<{ data?: unknown; count?: number }>) {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      const record: Query = { table, calls: [] };
      queries.push(record);
      const result = results.shift() ?? { data: [] };
      const builder: Record<string, unknown> = {};
      for (const method of [
        "select",
        "eq",
        "in",
        "or",
        "gte",
        "lte",
        "lt",
        "order",
        "limit",
        "range",
      ]) {
        builder[method] = (...args: unknown[]) => {
          record.calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({ error: null, ...result });
      return builder;
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return queries;
}

const PAYABLE = "10000.00";
const offline = { id: "p-off", enrollment_id: "e1", total_amount: "2500.00" };
// What finalize_razorpay_payment stores for a captured ₹4,000.50 payment.
const razorpay = { id: "p-rzp", enrollment_id: "e1", total_amount: 4000.5 };

beforeEach(() => {
  vi.clearAllMocks();
});

async function summary(
  paid: Array<{ id: string; enrollment_id: string; total_amount: string | number }>,
) {
  const queries = makeClient([{ data: paid }, { data: [] }]);
  const result = await getEnrollmentFinancialSummary("e1", PAYABLE);
  if (!result.ok) throw new Error(result.error);
  return { data: result.data, queries };
}

describe("a finalized Razorpay payment in Phase 14 and Phase 19", () => {
  it("moves the Phase 14 summary by exactly its amount, like an offline payment", async () => {
    const before = await summary([offline]);
    const after = await summary([offline, razorpay]);
    expect(after.data.totalPaidPaise - before.data.totalPaidPaise).toBe(400050);
    expect(before.data.outstandingPaise - after.data.outstandingPaise).toBe(400050);
    expect(after.data.outstandingPaise).toBe(349950);

    // Only status 'paid' is ever requested — a held ('authorized') row is excluded.
    const paymentsQuery = after.queries.find((q) => q.table === "payments")!;
    expect(paymentsQuery.calls.filter((c) => c.method === "eq")).toContainEqual({
      method: "eq",
      args: ["status", "paid"],
    });

    // An offline payment of the same amount gives the identical figures.
    const offlineTwin = await summary([
      offline,
      { id: "p-off2", enrollment_id: "e1", total_amount: "4000.50" },
    ]);
    expect(offlineTwin.data).toEqual(after.data);
  });

  it("reconciles with the Phase 19 Financial report row", async () => {
    const after = await summary([offline, razorpay]);
    makeClient([
      {
        data: [
          {
            id: "e1",
            enrollment_code: "ENR-000123",
            enrollment_date: "2026-10-01",
            enrollment_status: "active",
            total_payable: PAYABLE,
            student_code: "10001",
            student_first_name: "Asha",
            student_last_name: "Rao",
            program_name: "QA",
            batch_name: "B1",
          },
        ],
        count: 1,
      },
      { data: [offline, razorpay] },
      { data: [] },
    ]);
    const report = await getReportPage("financial", parseReportFilters("financial", {}));
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.data.rows[0]).toMatchObject(after.data);
  });
});
