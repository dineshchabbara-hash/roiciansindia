import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/data/refunds.ts with its I/O boundaries mocked: the Admin's
 * RLS-scoped client, the service-role client, the Razorpay gateway and the
 * Phase 14 summary. The database rules (cap, eligibility, immutability,
 * idempotency, RLS, concurrency) are proven in
 * supabase/tests/phase21b_refunds_test.sql and
 * scripts/test-refund-concurrency.sh.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/payments/razorpay-gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/razorpay-gateway")>();
  return { ...actual, createRazorpayGateway: vi.fn() };
});

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createRazorpayGateway } from "@/lib/payments/razorpay-gateway";
import {
  applyRefundWebhook,
  getPaymentRefunds,
  initiateRazorpayRefund,
  recordOfflineRefund,
  syncRazorpayRefund,
} from "@/lib/data/refunds";

const REFUND_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";

type Result = { data?: unknown; error?: unknown };

function makeClient(options: {
  tables?: Record<string, Result[]>;
  rpc?: Record<string, Result | Result[]>;
}) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const queues: Record<string, Result[]> = Object.fromEntries(
    Object.entries(options.tables ?? {}).map(([k, v]) => [k, [...v]]),
  );
  const rpcQueues: Record<string, Result[]> = Object.fromEntries(
    Object.entries(options.rpc ?? {}).map(([k, v]) => [
      k,
      Array.isArray(v) ? [...v] : [v],
    ]),
  );
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "maybeSingle", "single"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) =>
        Promise.resolve({
          data: null,
          error: null,
          ...(queues[table]?.shift() ?? {}),
        }).then(resolve, reject);
      return builder;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      const queue = rpcQueues[fn];
      const next = queue && queue.length > 1 ? queue.shift() : queue?.[0];
      return Promise.resolve({ data: null, error: null, ...(next ?? {}) });
    },
  };
  return { client, rpcCalls, calls };
}

function gateway(
  overrides: Partial<{ createRefund: unknown; listRefunds: unknown }> = {},
) {
  const g = {
    createOrder: vi.fn(),
    fetchPayment: vi.fn(),
    createRefund: vi.fn(),
    listRefunds: vi.fn(),
    ...overrides,
  };
  vi.mocked(createRazorpayGateway).mockReturnValue(g as never);
  return g;
}

const RAZORPAY_INPUT = {
  refundId: REFUND_ID,
  paymentId: PAYMENT_ID,
  amount: "2000.00",
  reason: "Batch cancelled",
};

const RESERVED = {
  data: [
    {
      refund_id: REFUND_ID,
      provider_payment_id: "pay_STORED",
      status: "initiated",
      razorpay_refund_id: null,
      already_reserved: false,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_UNITTEST01");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "unit-test-key-secret");
});

describe("reads", () => {
  it("maps the RLS-visible refunds of a payment", async () => {
    const viewer = makeClient({
      tables: {
        payment_refunds: [
          {
            data: [
              {
                id: REFUND_ID,
                amount: 2000.5,
                status: "processed",
                reason: "Downgrade",
                reference: "UTR1",
                refunded_on: "2026-10-12",
                razorpay_refund_id: null,
                created_at: "2026-10-12T05:00:00Z",
                initiator: { first_name: "Asha", last_name: "Admin" },
              },
            ],
          },
        ],
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    expect(await getPaymentRefunds(PAYMENT_ID)).toEqual({
      ok: true,
      data: [
        {
          id: REFUND_ID,
          amountPaise: 200050,
          status: "processed",
          reason: "Downgrade",
          reference: "UTR1",
          refundedOn: "2026-10-12",
          providerRefundId: null,
          createdAt: "2026-10-12T05:00:00Z",
          initiatedByName: "Asha Admin",
        },
      ],
    });
  });
});

describe("recordOfflineRefund", () => {
  const input = {
    refundId: REFUND_ID,
    paymentId: PAYMENT_ID,
    amount: "2000.00",
    reason: "Downgrade",
    refundedOn: "2026-10-12",
    reference: null,
  };

  it("calls record_offline_refund with only the validated form values", async () => {
    const viewer = makeClient({
      rpc: {
        record_offline_refund: {
          data: [{ refund_id: REFUND_ID, already_recorded: false }],
        },
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    expect(await recordOfflineRefund(input)).toEqual({
      ok: true,
      data: { id: REFUND_ID, alreadyRecorded: false },
    });
    expect(viewer.rpcCalls).toEqual([
      {
        fn: "record_offline_refund",
        args: {
          p_refund_id: REFUND_ID,
          p_payment_id: PAYMENT_ID,
          p_amount: "2000.00",
          p_reason: "Downgrade",
          p_refunded_on: "2026-10-12",
          p_reference: null,
        },
      },
    ]);
  });

  it.each([
    [
      "P2101",
      "Amount exceeds the refundable balance of 800.00",
      "Amount exceeds the refundable balance of 800.00.",
    ],
    [
      "P2102",
      "A Razorpay payment is refunded through Razorpay, not recorded manually",
      "A Razorpay payment is refunded through Razorpay, not recorded manually.",
    ],
    [
      "22023",
      "Refund date cannot be earlier than the payment date",
      "Refund date cannot be earlier than the payment date.",
    ],
    ["P2104", "Payment not found", "Payment not found."],
    [
      "42501",
      "Only Admin/Super Admin may record a refund",
      "You are not authorized to refund payments.",
    ],
  ])("surfaces database rule %s", async (code, message, shown) => {
    const viewer = makeClient({
      rpc: { record_offline_refund: { error: { code, message } } },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    expect(await recordOfflineRefund(input)).toEqual({ ok: false, error: shown });
  });
});

describe("initiateRazorpayRefund", () => {
  it("reserves first, then refunds the STORED provider payment id with our id in receipt/notes", async () => {
    const viewer = makeClient({ rpc: { reserve_razorpay_refund: RESERVED } });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    const admin = makeClient({
      rpc: {
        apply_razorpay_refund_status: {
          data: [{ refund_id: REFUND_ID, outcome: "processed" }],
        },
      },
      tables: { payment_refunds: [{ data: { status: "processed" } }] },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);
    const g = gateway({
      createRefund: vi.fn(async () => ({
        id: "rfnd_1",
        paymentId: "pay_STORED",
        amountPaise: 200000,
        currency: "INR",
        status: "processed",
        notes: {},
      })),
    });

    const result = await initiateRazorpayRefund(RAZORPAY_INPUT);

    expect(result).toEqual({
      ok: true,
      data: {
        id: REFUND_ID,
        status: "processed",
        alreadyReserved: false,
        awaitingConfirmation: false,
      },
    });
    expect(g.createRefund).toHaveBeenCalledWith({
      paymentId: "pay_STORED",
      amountPaise: 200000,
      receipt: REFUND_ID,
      notes: { roicians_refund_id: REFUND_ID },
    });
    expect(admin.rpcCalls[0]).toEqual({
      fn: "apply_razorpay_refund_status",
      args: {
        p_refund_id: REFUND_ID,
        p_provider_payment_id: "pay_STORED",
        p_provider_refund_id: "rfnd_1",
        p_amount_paise: 200000,
        p_currency: "INR",
        p_provider_status: "processed",
        p_source: "api",
      },
    });
  });

  it("a repeated submission never calls Razorpay again", async () => {
    const viewer = makeClient({
      rpc: {
        reserve_razorpay_refund: {
          data: [
            {
              ...RESERVED.data[0],
              already_reserved: true,
              status: "initiated",
              razorpay_refund_id: "rfnd_1",
            },
          ],
        },
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    const g = gateway();
    expect(await initiateRazorpayRefund(RAZORPAY_INPUT)).toMatchObject({
      ok: true,
      data: { alreadyReserved: true, awaitingConfirmation: true },
    });
    expect(g.createRefund).not.toHaveBeenCalled();
  });

  it("releases the reservation when Razorpay definitively rejects the refund", async () => {
    const viewer = makeClient({ rpc: { reserve_razorpay_refund: RESERVED } });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    const admin = makeClient({ rpc: { fail_unsent_razorpay_refund: { data: true } } });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);
    gateway({
      createRefund: vi.fn(async () =>
        Promise.reject({ statusCode: 400, error: { description: "x" } }),
      ),
    });

    expect(await initiateRazorpayRefund(RAZORPAY_INPUT)).toEqual({
      ok: false,
      error: "Razorpay declined this refund. No money was refunded.",
    });
    expect(admin.rpcCalls).toEqual([
      { fn: "fail_unsent_razorpay_refund", args: { p_refund_id: REFUND_ID } },
    ]);
  });

  it("keeps the reservation (awaiting confirmation) when Razorpay's answer is lost", async () => {
    const viewer = makeClient({ rpc: { reserve_razorpay_refund: RESERVED } });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    const admin = makeClient({});
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);
    gateway({ createRefund: vi.fn(async () => Promise.reject(new Error("ETIMEDOUT"))) });

    expect(await initiateRazorpayRefund(RAZORPAY_INPUT)).toEqual({
      ok: true,
      data: {
        id: REFUND_ID,
        status: "initiated",
        alreadyReserved: false,
        awaitingConfirmation: true,
      },
    });
    expect(admin.rpcCalls).toEqual([]);
  });

  it("refuses to call Razorpay without TEST keys and releases the reservation", async () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_REALKEY");
    const viewer = makeClient({ rpc: { reserve_razorpay_refund: RESERVED } });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    const admin = makeClient({ rpc: { fail_unsent_razorpay_refund: { data: true } } });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);
    const g = gateway();
    expect(await initiateRazorpayRefund(RAZORPAY_INPUT)).toEqual({
      ok: false,
      error: "Online refunds are unavailable right now. No money was refunded.",
    });
    expect(g.createRefund).not.toHaveBeenCalled();
  });

  it("surfaces the database's capacity refusal without calling Razorpay", async () => {
    const viewer = makeClient({
      rpc: {
        reserve_razorpay_refund: {
          error: {
            code: "P2101",
            message: "Amount exceeds the refundable balance of 1000.00",
          },
        },
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    const g = gateway();
    expect(await initiateRazorpayRefund(RAZORPAY_INPUT)).toEqual({
      ok: false,
      error: "Amount exceeds the refundable balance of 1000.00.",
    });
    expect(g.createRefund).not.toHaveBeenCalled();
  });
});

describe("syncRazorpayRefund", () => {
  const initiatedRow = (overrides: Record<string, unknown> = {}) => ({
    data: {
      id: REFUND_ID,
      status: "initiated",
      razorpay_refund_id: null,
      created_at: "2026-10-12T05:00:00Z",
      payment: { razorpay_payment_id: "pay_STORED" },
      ...overrides,
    },
  });

  it("applies Razorpay's record found by our id in notes", async () => {
    const viewer = makeClient({ tables: { payment_refunds: [initiatedRow()] } });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    const admin = makeClient({
      rpc: {
        apply_razorpay_refund_status: {
          data: [{ refund_id: REFUND_ID, outcome: "processed" }],
        },
      },
      tables: { payment_refunds: [{ data: { status: "processed" } }] },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);
    gateway({
      listRefunds: vi.fn(async () => [
        {
          id: "rfnd_other",
          paymentId: "pay_STORED",
          amountPaise: 1,
          currency: "INR",
          status: "processed",
          notes: {},
        },
        {
          id: "rfnd_ours",
          paymentId: "pay_STORED",
          amountPaise: 200000,
          currency: "INR",
          status: "processed",
          notes: { roicians_refund_id: REFUND_ID },
        },
      ]),
    });

    expect(await syncRazorpayRefund(REFUND_ID, new Date("2026-10-12T05:01:00Z"))).toEqual(
      {
        ok: true,
        data: { status: "processed" },
      },
    );
    expect(admin.rpcCalls[0].args).toMatchObject({
      p_refund_id: REFUND_ID,
      p_provider_refund_id: "rfnd_ours",
      p_source: "sync",
    });
  });

  it("releases a reservation Razorpay never created only after 10 minutes", async () => {
    const young = makeClient({ tables: { payment_refunds: [initiatedRow()] } });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(young.client as never);
    const admin = makeClient({
      tables: { payment_refunds: [{ data: { status: "initiated" } }] },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);
    gateway({ listRefunds: vi.fn(async () => []) });
    expect(await syncRazorpayRefund(REFUND_ID, new Date("2026-10-12T05:05:00Z"))).toEqual(
      {
        ok: true,
        data: { status: "initiated" },
      },
    );
    expect(admin.rpcCalls).toEqual([]);

    const old = makeClient({ tables: { payment_refunds: [initiatedRow()] } });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(old.client as never);
    const admin2 = makeClient({
      rpc: { fail_unsent_razorpay_refund: { data: true } },
      tables: { payment_refunds: [{ data: { status: "failed" } }] },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin2.client as never);
    expect(await syncRazorpayRefund(REFUND_ID, new Date("2026-10-12T05:11:00Z"))).toEqual(
      {
        ok: true,
        data: { status: "failed" },
      },
    );
    expect(admin2.rpcCalls).toEqual([
      { fn: "fail_unsent_razorpay_refund", args: { p_refund_id: REFUND_ID } },
    ]);
  });

  it("does nothing for a refund that is already final", async () => {
    const viewer = makeClient({
      tables: { payment_refunds: [initiatedRow({ status: "processed" })] },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(viewer.client as never);
    const g = gateway();
    expect(await syncRazorpayRefund(REFUND_ID)).toEqual({
      ok: true,
      data: { status: "processed" },
    });
    expect(g.listRefunds).not.toHaveBeenCalled();
  });
});

describe("applyRefundWebhook", () => {
  it("applies a signed refund event with our id from notes", async () => {
    const admin = makeClient({
      rpc: {
        apply_razorpay_refund_status: {
          data: [{ refund_id: REFUND_ID, outcome: "processed" }],
        },
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);
    expect(
      await applyRefundWebhook({
        id: "rfnd_1",
        payment_id: "pay_STORED",
        amount: 200000,
        currency: "INR",
        status: "processed",
        notes: { roicians_refund_id: REFUND_ID },
      }),
    ).toBe("processed");
    expect(admin.rpcCalls[0].args).toEqual({
      p_refund_id: REFUND_ID,
      p_provider_payment_id: "pay_STORED",
      p_provider_refund_id: "rfnd_1",
      p_amount_paise: 200000,
      p_currency: "INR",
      p_provider_status: "processed",
      p_source: "webhook",
    });
  });

  it("ignores an incomplete entity and a non-uuid note", async () => {
    expect(await applyRefundWebhook({ id: "rfnd_1" })).toBe("ignored_incomplete");
    const admin = makeClient({
      rpc: {
        apply_razorpay_refund_status: {
          data: [{ refund_id: null, outcome: "unknown_refund" }],
        },
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);
    expect(
      await applyRefundWebhook({
        id: "rfnd_1",
        payment_id: "pay_X",
        amount: 1,
        currency: "INR",
        status: "processed",
        notes: { roicians_refund_id: "'; drop table" },
      }),
    ).toBe("unknown_refund");
    expect(admin.rpcCalls[0].args.p_refund_id).toBeNull();
  });
});
