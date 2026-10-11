import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/data/online-payments.ts with every I/O boundary mocked: the
 * Student's Phase 14 enrollment read (getMyEnrollment), the plan read, the
 * Razorpay gateway (no network) and the service-role Supabase client. The
 * real config, signature verification, coverage rule and decision logic
 * run. Database invariants (idempotency, one paid row per order, holds,
 * RLS) are proven in supabase/tests/phase20b_razorpay_test.sql.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/data/student-portal", () => ({ getMyEnrollment: vi.fn() }));
vi.mock("@/lib/data/payment-plans", () => ({ getPaymentPlanForEnrollment: vi.fn() }));
vi.mock("@/lib/payments/razorpay-gateway", () => ({ createRazorpayGateway: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

import { getMyEnrollment } from "@/lib/data/student-portal";
import { getPaymentPlanForEnrollment } from "@/lib/data/payment-plans";
import { createRazorpayGateway } from "@/lib/payments/razorpay-gateway";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createMyOnlineOrder,
  getMyOnlinePaymentQuote,
  processRazorpayWebhook,
  verifyMyCheckout,
} from "@/lib/data/online-payments";

// Test-only placeholder credentials.
const KEY_ID = "rzp_test_UNITTEST01";
const KEY_SECRET = "unit-test-key-secret";
const WEBHOOK_SECRET = "unit-test-webhook-secret";

const ENROLLMENT_ID = "11111111-2222-4333-8444-555555555555";
const STUDENT_ID = "s-own";
const AUTH_USER = "auth-own";

type Call = { table: string; method: string; args: unknown[] };

function makeAdmin(options: {
  tables?: Record<string, unknown>;
  rpc?: Record<string, { data?: unknown; error?: unknown }>;
}) {
  const calls: Call[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "gt", "upsert", "update", "maybeSingle"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: options.tables?.[table] ?? null, error: null });
      return builder;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null, ...(options.rpc?.[fn] ?? {}) });
    },
  };
  vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);
  return { calls, rpcCalls };
}

function makeGateway(
  overrides: Partial<{ createOrder: unknown; fetchPayment: unknown }> = {},
) {
  const gateway = {
    createOrder: vi.fn(async (input: { amountPaise: number }) => ({
      id: "order_NEW1",
      amountPaise: input.amountPaise,
      currency: "INR",
      status: "created",
    })),
    fetchPayment: vi.fn(),
    ...overrides,
  };
  vi.mocked(createRazorpayGateway).mockReturnValue(gateway as never);
  return gateway;
}

function enrollment(overrides: Record<string, unknown> = {}) {
  vi.mocked(getMyEnrollment).mockResolvedValue({
    ok: true,
    data: {
      id: ENROLLMENT_ID,
      enrollmentCode: "ENR-000123",
      programName: "QA",
      programCode: "QA-01",
      batchName: "B1",
      status: "active",
      enrollmentDate: "2026-10-01",
      totalPayablePaise: 1000000,
      outstandingPaise: 600000,
      ...overrides,
    },
  } as never);
}

function plan(
  installments: Array<{
    id: string;
    sequence: number;
    amount: string;
    storedStatus?: string;
  }> | null,
) {
  vi.mocked(getPaymentPlanForEnrollment).mockResolvedValue({
    ok: true,
    data: installments && {
      id: "plan1",
      enrollmentId: ENROLLMENT_ID,
      totalAmount: "10000.00",
      installments: installments.map((i) => ({
        label: null,
        dueDate: "2026-10-01",
        storedStatus: "upcoming",
        displayStatus: "due",
        editable: true,
        ...i,
      })),
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("RAZORPAY_KEY_ID", KEY_ID);
  vi.stubEnv("RAZORPAY_KEY_SECRET", KEY_SECRET);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------

describe("getMyOnlinePaymentQuote", () => {
  it("derives both options from the Phase 14 figures and oldest-first coverage", async () => {
    enrollment(); // paid 4000.00 of 10000.00, outstanding 6000.00
    plan([
      { id: "i1", sequence: 1, amount: "3000.00" },
      { id: "i2", sequence: 2, amount: "3000.00" },
      { id: "i3", sequence: 3, amount: "4000.00" },
    ]);
    const result = await getMyOnlinePaymentQuote(ENROLLMENT_ID);
    expect(result.ok && result.data.options).toEqual([
      {
        purpose: "next_installment",
        amountPaise: 200000,
        installmentId: "i2",
        label: "Pay next installment (Installment 2)",
      },
      {
        purpose: "full_outstanding",
        amountPaise: 600000,
        installmentId: null,
        label: "Pay full outstanding balance",
      },
    ]);
  });

  it("offers nothing for an ineligible or fully paid enrollment", async () => {
    enrollment({ status: "lead" });
    let result = await getMyOnlinePaymentQuote(ENROLLMENT_ID);
    expect(result.ok && result.data).toMatchObject({ eligible: false, options: [] });
    enrollment({ outstandingPaise: 0 });
    result = await getMyOnlinePaymentQuote(ENROLLMENT_ID);
    expect(result.ok && result.data.options).toEqual([]);
    expect(getPaymentPlanForEnrollment).not.toHaveBeenCalled();
  });

  it("passes through 'not found' for another student's enrollment (ownership is the session's)", async () => {
    vi.mocked(getMyEnrollment).mockResolvedValue({
      ok: false,
      error: "Enrollment not found.",
    });
    expect(await getMyOnlinePaymentQuote(ENROLLMENT_ID)).toEqual({
      ok: false,
      error: "Enrollment not found.",
    });
  });
});

describe("createMyOnlineOrder", () => {
  it("creates the Razorpay order for the server-derived amount and registers it", async () => {
    enrollment();
    plan(null);
    const gateway = makeGateway();
    const { rpcCalls } = makeAdmin({});
    const result = await createMyOnlineOrder({
      enrollmentId: ENROLLMENT_ID,
      purpose: "full_outstanding",
      studentId: STUDENT_ID,
      authUserId: AUTH_USER,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        keyId: KEY_ID,
        orderId: "order_NEW1",
        amountPaise: 600000,
        currency: "INR",
        enrollmentCode: "ENR-000123",
        description: "ENR-000123 — Pay full outstanding balance",
      },
    });
    expect(gateway.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amountPaise: 600000,
        notes: {
          enrollment_code: "ENR-000123",
          program_code: "QA-01",
          purpose: "full_outstanding",
        },
      }),
    );
    expect(rpcCalls).toEqual([
      {
        fn: "register_razorpay_order",
        args: {
          p_provider_order_id: "order_NEW1",
          p_enrollment_id: ENROLLMENT_ID,
          p_student_id: STUDENT_ID,
          p_purpose: "full_outstanding",
          p_installment_id: null,
          p_amount: "6000.00",
          p_created_by_auth_user_id: AUTH_USER,
          p_ttl_minutes: 30,
        },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(KEY_SECRET);
  });

  it("reuses a still-open order for the same amount instead of creating another", async () => {
    enrollment();
    plan(null);
    const gateway = makeGateway();
    const { rpcCalls } = makeAdmin({
      tables: {
        payment_orders: {
          provider_order_id: "order_OPEN",
          purpose: "full_outstanding",
          installment_id: null,
          amount: "6000.00",
        },
      },
    });
    const result = await createMyOnlineOrder({
      enrollmentId: ENROLLMENT_ID,
      purpose: "full_outstanding",
      studentId: STUDENT_ID,
      authUserId: AUTH_USER,
    });
    expect(result.ok && result.data.orderId).toBe("order_OPEN");
    expect(gateway.createOrder).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([]);
  });

  it("refuses a purpose that is not currently on offer (no client amount path exists)", async () => {
    enrollment({ outstandingPaise: 0 });
    const gateway = makeGateway();
    makeAdmin({});
    const result = await createMyOnlineOrder({
      enrollmentId: ENROLLMENT_ID,
      purpose: "full_outstanding",
      studentId: STUDENT_ID,
      authUserId: AUTH_USER,
    });
    expect(result.ok).toBe(false);
    expect(gateway.createOrder).not.toHaveBeenCalled();
  });

  it("refuses to run with a live key", async () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_PLACEHOLDER");
    enrollment();
    const gateway = makeGateway();
    const result = await createMyOnlineOrder({
      enrollmentId: ENROLLMENT_ID,
      purpose: "full_outstanding",
      studentId: STUDENT_ID,
      authUserId: AUTH_USER,
    });
    expect(result).toEqual({
      ok: false,
      error: "Online payment is unavailable right now. Please try again later.",
    });
    expect(gateway.createOrder).not.toHaveBeenCalled();
  });

  it("reports a balance change when the database guard rejects the amount", async () => {
    enrollment();
    plan(null);
    makeGateway();
    makeAdmin({
      rpc: { register_razorpay_order: { error: { code: "P2001", message: "x" } } },
    });
    const result = await createMyOnlineOrder({
      enrollmentId: ENROLLMENT_ID,
      purpose: "full_outstanding",
      studentId: STUDENT_ID,
      authUserId: AUTH_USER,
    });
    expect(result).toEqual({
      ok: false,
      error: "Your balance has changed. Refresh the page and try again.",
    });
  });

  it("does not register an order whose provider amount differs", async () => {
    enrollment();
    plan(null);
    makeGateway({
      createOrder: vi.fn(async () => ({
        id: "order_BAD",
        amountPaise: 1,
        currency: "INR",
        status: "created",
      })),
    });
    const { rpcCalls } = makeAdmin({});
    const result = await createMyOnlineOrder({
      enrollmentId: ENROLLMENT_ID,
      purpose: "full_outstanding",
      studentId: STUDENT_ID,
      authUserId: AUTH_USER,
    });
    expect(result.ok).toBe(false);
    expect(rpcCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

function checkout(orderId = "order_A1", paymentId = "pay_A1", secret = KEY_SECRET) {
  return {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex"),
  };
}

const ownOrder = {
  payment_orders: { enrollment_id: ENROLLMENT_ID, student_id: STUDENT_ID },
};

describe("verifyMyCheckout", () => {
  it("rejects a bad signature before touching Razorpay or the database", async () => {
    const gateway = makeGateway();
    const { rpcCalls, calls } = makeAdmin({ tables: ownOrder });
    const result = await verifyMyCheckout({
      checkout: checkout("order_A1", "pay_A1", "forged-secret"),
      studentId: STUDENT_ID,
    });
    expect(result.status).toBe("failed");
    expect(gateway.fetchPayment).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it("refuses another student's order with the same generic answer", async () => {
    const gateway = makeGateway();
    const { rpcCalls } = makeAdmin({
      tables: { payment_orders: { enrollment_id: ENROLLMENT_ID, student_id: "s-other" } },
    });
    const result = await verifyMyCheckout({
      checkout: checkout(),
      studentId: STUDENT_ID,
    });
    expect(result.status).toBe("failed");
    expect(gateway.fetchPayment).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([]);
  });

  it("finalizes with Razorpay's own captured amount, never a browser value", async () => {
    makeGateway({
      fetchPayment: vi.fn(async () => ({
        id: "pay_A1",
        orderId: "order_A1",
        amountPaise: 600000,
        currency: "INR",
        status: "captured",
        createdAtUnix: 1791700000,
      })),
    });
    const { rpcCalls } = makeAdmin({
      tables: ownOrder,
      rpc: {
        finalize_razorpay_payment: {
          data: [{ payment_id: "p1", payment_code: "PAY-000010", outcome: "recorded" }],
        },
      },
    });
    const result = await verifyMyCheckout({
      checkout: checkout(),
      studentId: STUDENT_ID,
    });
    expect(result).toEqual({
      status: "paid",
      paymentCode: "PAY-000010",
      enrollmentId: ENROLLMENT_ID,
    });
    expect(rpcCalls).toEqual([
      {
        fn: "finalize_razorpay_payment",
        args: {
          p_provider_order_id: "order_A1",
          p_provider_payment_id: "pay_A1",
          p_amount_paise: 600000,
          p_currency: "INR",
          p_provider_status: "captured",
          p_paid_at: new Date(1791700000 * 1000).toISOString(),
          p_source: "checkout",
        },
      },
    ]);
  });

  it("treats a repeated callback (already recorded) as paid", async () => {
    makeGateway({
      fetchPayment: vi.fn(async () => ({
        id: "pay_A1",
        orderId: "order_A1",
        amountPaise: 600000,
        currency: "INR",
        status: "captured",
        createdAtUnix: null,
      })),
    });
    makeAdmin({
      tables: ownOrder,
      rpc: {
        finalize_razorpay_payment: {
          data: [
            { payment_id: "p1", payment_code: "PAY-000010", outcome: "already_recorded" },
          ],
        },
      },
    });
    expect(
      await verifyMyCheckout({ checkout: checkout(), studentId: STUDENT_ID }),
    ).toMatchObject({ status: "paid" });
  });

  it.each([
    ["authorized (not yet captured)", "authorized", "processing"],
    ["failed", "failed", "failed"],
  ])("does not finalize a %s payment", async (_label, providerStatus, expected) => {
    makeGateway({
      fetchPayment: vi.fn(async () => ({
        id: "pay_A1",
        orderId: "order_A1",
        amountPaise: 600000,
        currency: "INR",
        status: providerStatus,
        createdAtUnix: null,
      })),
    });
    const { rpcCalls } = makeAdmin({ tables: ownOrder });
    const result = await verifyMyCheckout({
      checkout: checkout(),
      studentId: STUDENT_ID,
    });
    expect(result.status).toBe(expected);
    expect(rpcCalls).toEqual([]);
  });

  it("refuses a fetched payment that belongs to a different order", async () => {
    makeGateway({
      fetchPayment: vi.fn(async () => ({
        id: "pay_A1",
        orderId: "order_OTHER",
        amountPaise: 600000,
        currency: "INR",
        status: "captured",
        createdAtUnix: null,
      })),
    });
    const { rpcCalls } = makeAdmin({ tables: ownOrder });
    expect(
      (await verifyMyCheckout({ checkout: checkout(), studentId: STUDENT_ID })).status,
    ).toBe("failed");
    expect(rpcCalls).toEqual([]);
  });

  it("reports a held payment as held", async () => {
    makeGateway({
      fetchPayment: vi.fn(async () => ({
        id: "pay_A1",
        orderId: "order_A1",
        amountPaise: 600000,
        currency: "INR",
        status: "captured",
        createdAtUnix: null,
      })),
    });
    makeAdmin({
      tables: ownOrder,
      rpc: {
        finalize_razorpay_payment: {
          data: [{ payment_id: "p1", payment_code: "PAY-000011", outcome: "held" }],
        },
      },
    });
    expect(
      await verifyMyCheckout({ checkout: checkout(), studentId: STUDENT_ID }),
    ).toEqual({
      status: "held",
      enrollmentId: ENROLLMENT_ID,
    });
  });
});

// ---------------------------------------------------------------------------

function webhookBody(event = "payment.captured", entity: Record<string, unknown> = {}) {
  return JSON.stringify({
    entity: "event",
    event,
    payload: {
      payment: {
        entity: {
          id: "pay_W1",
          order_id: "order_W1",
          amount: 600000,
          currency: "INR",
          status: "captured",
          created_at: 1791700000,
          ...entity,
        },
      },
    },
  });
}

function sign(body: string, secret = WEBHOOK_SECRET) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("processRazorpayWebhook", () => {
  it("answers 503 and touches nothing when the webhook secret is not configured", async () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    const { calls, rpcCalls } = makeAdmin({});
    const body = webhookBody();
    expect(
      await processRazorpayWebhook({
        rawBody: body,
        signature: sign(body),
        eventIdHeader: "evt_1",
      }),
    ).toEqual({
      httpStatus: 503,
      outcome: "not_configured",
    });
    expect(calls).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it("rejects an invalid signature with 400 before any database work", async () => {
    const { calls, rpcCalls } = makeAdmin({});
    const body = webhookBody();
    const result = await processRazorpayWebhook({
      rawBody: body,
      signature: sign(body, "forged"),
      eventIdHeader: "evt_1",
    });
    expect(result).toEqual({ httpStatus: 400, outcome: "invalid_signature" });
    expect(calls).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it("finalizes a signed payment.captured from the event's own entity and marks the event processed", async () => {
    const { calls, rpcCalls } = makeAdmin({
      tables: { razorpay_webhook_events: { processed_at: null } },
      rpc: {
        finalize_razorpay_payment: {
          data: [{ payment_id: "p1", payment_code: "PAY-000012", outcome: "recorded" }],
        },
      },
    });
    const body = webhookBody();
    const result = await processRazorpayWebhook({
      rawBody: body,
      signature: sign(body),
      eventIdHeader: "evt_1",
    });
    expect(result).toEqual({ httpStatus: 200, outcome: "recorded" });
    expect(rpcCalls[0]).toEqual({
      fn: "finalize_razorpay_payment",
      args: expect.objectContaining({
        p_provider_order_id: "order_W1",
        p_provider_payment_id: "pay_W1",
        p_amount_paise: 600000,
        p_source: "webhook",
      }),
    });
    expect(calls.find((c) => c.method === "upsert")?.args[0]).toEqual({
      event_id: "evt_1",
      event_type: "payment.captured",
      provider_order_id: "order_W1",
      provider_payment_id: "pay_W1",
    });
    expect(calls.find((c) => c.method === "update")?.args[0]).toMatchObject({
      outcome: "recorded",
    });
  });

  it("acknowledges an already-processed event id without finalizing again", async () => {
    const { rpcCalls } = makeAdmin({
      tables: { razorpay_webhook_events: { processed_at: "2026-10-11T00:00:00Z" } },
    });
    const body = webhookBody();
    expect(
      await processRazorpayWebhook({
        rawBody: body,
        signature: sign(body),
        eventIdHeader: "evt_1",
      }),
    ).toEqual({
      httpStatus: 200,
      outcome: "duplicate",
    });
    expect(rpcCalls).toEqual([]);
  });

  it("ignores other events and incomplete captured events", async () => {
    const { rpcCalls } = makeAdmin({
      tables: { razorpay_webhook_events: { processed_at: null } },
    });
    let body = webhookBody("payment.failed", { status: "failed" });
    expect(
      (
        await processRazorpayWebhook({
          rawBody: body,
          signature: sign(body),
          eventIdHeader: "evt_2",
        })
      ).outcome,
    ).toBe("ignored");
    body = webhookBody("payment.captured", { status: "authorized" });
    expect(
      (
        await processRazorpayWebhook({
          rawBody: body,
          signature: sign(body),
          eventIdHeader: "evt_3",
        })
      ).outcome,
    ).toBe("ignored_incomplete");
    expect(rpcCalls).toEqual([]);
  });

  it("returns 500 (so Razorpay redelivers) and leaves the event unprocessed when finalization fails", async () => {
    const { calls } = makeAdmin({
      tables: { razorpay_webhook_events: { processed_at: null } },
      rpc: {
        finalize_razorpay_payment: { error: { code: "XX000", message: "db down" } },
      },
    });
    const body = webhookBody();
    expect(
      await processRazorpayWebhook({
        rawBody: body,
        signature: sign(body),
        eventIdHeader: "evt_4",
      }),
    ).toEqual({
      httpStatus: 500,
      outcome: "error",
    });
    expect(calls.some((c) => c.method === "update")).toBe(false);
  });

  it("never logs the secret or the signature", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    makeAdmin({});
    const body = webhookBody();
    const forged = sign(body, "forged");
    await processRazorpayWebhook({
      rawBody: body,
      signature: forged,
      eventIdHeader: "evt_5",
    });
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain(WEBHOOK_SECRET);
    expect(logged).not.toContain(forged);
  });
});
