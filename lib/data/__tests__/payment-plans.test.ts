import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getPaymentPlanForEnrollment,
  createPaymentPlanForEnrollment,
  addInstallmentToPlan,
  editInstallment,
  waiveInstallment,
  removeInstallment,
} from "@/lib/data/payment-plans";

// Same queue-dispatch mock as lib/data/__tests__/attendance.test.ts's own
// createFromMock — each call to the same table consumes the next queued
// chain, in call order.
function createFromMock(queues: Record<string, Array<unknown>>) {
  const cursors: Record<string, number> = {};
  return vi.fn((table: string) => {
    const queue = queues[table] ?? [];
    const i = cursors[table] ?? 0;
    cursors[table] = i + 1;
    if (i >= queue.length) {
      throw new Error(`No mock queued for from("${table}") call #${i + 1}`);
    }
    return queue[i];
  });
}

// Far in the past / far in the future, so the "today" comparison inside
// deriveInstallmentDisplayStatus is unambiguous without mocking Date.
const PAST_DATE = "2020-01-01";
const FUTURE_DATE = "2099-01-01";

beforeEach(() => vi.clearAllMocks());

describe("getPaymentPlanForEnrollment", () => {
  it("returns null when no plan exists yet", async () => {
    const planMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const from = createFromMock({
      payment_plans: [
        { select: () => ({ eq: () => ({ maybeSingle: planMaybeSingle }) }) },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await getPaymentPlanForEnrollment("enr-1");
    expect(result).toEqual({ ok: true, data: null });
  });

  it("maps installments to their derived display status, including waived and overdue", async () => {
    const planMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "plan-1", enrollment_id: "enr-1", total_amount: "30000.00" },
      error: null,
    });
    const installmentsOrder = vi.fn().mockResolvedValue({
      data: [
        {
          id: "inst-1",
          sequence: 1,
          label: "Registration",
          amount: "10000.00",
          due_date: PAST_DATE,
          status: "upcoming",
          amount_paid_cache: "0.00",
        },
        {
          id: "inst-2",
          sequence: 2,
          label: "Installment 1",
          amount: "20000.00",
          due_date: FUTURE_DATE,
          status: "waived",
          amount_paid_cache: "0.00",
        },
      ],
      error: null,
    });
    const from = createFromMock({
      payment_plans: [
        { select: () => ({ eq: () => ({ maybeSingle: planMaybeSingle }) }) },
      ],
      installments: [{ select: () => ({ eq: () => ({ order: installmentsOrder }) }) }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await getPaymentPlanForEnrollment("enr-1");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) return;
    expect(result.data.installments[0].displayStatus).toBe("overdue");
    expect(result.data.installments[0].editable).toBe(true);
    expect(result.data.installments[1].displayStatus).toBe("waived");
  });
});

describe("createPaymentPlanForEnrollment", () => {
  const oneLine = {
    installments: [{ label: null, amount: "10000.00", dueDate: FUTURE_DATE }],
  };

  it("rejects when a plan already exists for this enrollment", async () => {
    const existingMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "plan-existing" }, error: null });
    const from = createFromMock({
      payment_plans: [
        { select: () => ({ eq: () => ({ maybeSingle: existingMaybeSingle }) }) },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createPaymentPlanForEnrollment("enr-1", oneLine);
    expect(result).toEqual({
      ok: false,
      error: "This enrollment already has a payment plan.",
    });
  });

  it("blocks a multi-line plan when the program disallows installments", async () => {
    const existingMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const programMaybeSingle = vi.fn().mockResolvedValue({
      data: { program: { installments_allowed: false } },
      error: null,
    });
    const from = createFromMock({
      payment_plans: [
        { select: () => ({ eq: () => ({ maybeSingle: existingMaybeSingle }) }) },
      ],
      enrollments: [
        { select: () => ({ eq: () => ({ maybeSingle: programMaybeSingle }) }) },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createPaymentPlanForEnrollment("enr-1", {
      installments: [
        { label: "Registration", amount: "10000.00", dueDate: FUTURE_DATE },
        { label: "Installment 1", amount: "20000.00", dueDate: FUTURE_DATE },
      ],
    });
    expect(result).toEqual({
      ok: false,
      error: "This program does not permit splitting fees into installments.",
    });
  });

  it("creates a single-line plan with total_amount computed as the sum of its lines (no gating check for a single line)", async () => {
    const existingMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const planInsertSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "plan-1" }, error: null });
    let planInsertPayload: unknown;
    let installmentsInsertPayload: unknown;
    const installmentsInsert = vi.fn().mockImplementation((payload: unknown) => {
      installmentsInsertPayload = payload;
      return { error: null };
    });

    const from = createFromMock({
      payment_plans: [
        { select: () => ({ eq: () => ({ maybeSingle: existingMaybeSingle }) }) },
        {
          insert: (payload: unknown) => {
            planInsertPayload = payload;
            return { select: () => ({ single: planInsertSingle }) };
          },
        },
      ],
      installments: [{ insert: installmentsInsert }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createPaymentPlanForEnrollment("enr-1", {
      installments: [{ label: "Full payment", amount: "30000.50", dueDate: FUTURE_DATE }],
    });
    expect(result).toEqual({ ok: true, data: { id: "plan-1" } });
    expect(planInsertPayload).toMatchObject({
      enrollment_id: "enr-1",
      total_amount: "30000.50",
    });
    expect(installmentsInsertPayload).toEqual([
      {
        payment_plan_id: "plan-1",
        sequence: 1,
        label: "Full payment",
        amount: "30000.50",
        due_date: FUTURE_DATE,
      },
    ]);
  });

  it("creates a multi-line plan when the program allows installments, with total_amount as the exact sum", async () => {
    const existingMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const programMaybeSingle = vi.fn().mockResolvedValue({
      data: { program: { installments_allowed: true } },
      error: null,
    });
    const planInsertSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "plan-1" }, error: null });
    let planInsertPayload: unknown;
    const installmentsInsert = vi.fn().mockResolvedValue({ error: null });

    const from = createFromMock({
      payment_plans: [
        { select: () => ({ eq: () => ({ maybeSingle: existingMaybeSingle }) }) },
        {
          insert: (payload: unknown) => {
            planInsertPayload = payload;
            return { select: () => ({ single: planInsertSingle }) };
          },
        },
      ],
      enrollments: [
        { select: () => ({ eq: () => ({ maybeSingle: programMaybeSingle }) }) },
      ],
      installments: [{ insert: installmentsInsert }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createPaymentPlanForEnrollment("enr-1", {
      installments: [
        { label: "Registration", amount: "10000.00", dueDate: FUTURE_DATE },
        { label: "Installment 1", amount: "20000.00", dueDate: FUTURE_DATE },
      ],
    });
    expect(result).toEqual({ ok: true, data: { id: "plan-1" } });
    expect(planInsertPayload).toMatchObject({ total_amount: "30000.00" });
  });

  it("rolls back the newly-created plan when the installments insert fails", async () => {
    const existingMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const planInsertSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "plan-1" }, error: null });
    const installmentsInsert = vi
      .fn()
      .mockResolvedValue({ error: { message: "insert failed" } });
    const rollbackEq = vi.fn().mockResolvedValue({ error: null });

    const from = createFromMock({
      payment_plans: [
        { select: () => ({ eq: () => ({ maybeSingle: existingMaybeSingle }) }) },
        { insert: () => ({ select: () => ({ single: planInsertSingle }) }) },
        { delete: () => ({ eq: rollbackEq }) },
      ],
      installments: [{ insert: installmentsInsert }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createPaymentPlanForEnrollment("enr-1", oneLine);
    expect(result.ok).toBe(false);
    expect(rollbackEq).toHaveBeenCalledWith("id", "plan-1");
  });
});

describe("addInstallmentToPlan", () => {
  it("re-checks installments_allowed only when going from 1 line to 2+", async () => {
    const planMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "plan-1", enrollment_id: "enr-1" }, error: null });
    const currentEq = vi.fn().mockResolvedValue({ data: [{ sequence: 1 }], error: null });
    const programMaybeSingle = vi.fn().mockResolvedValue({
      data: { program: { installments_allowed: false } },
      error: null,
    });

    const from = createFromMock({
      payment_plans: [
        { select: () => ({ eq: () => ({ maybeSingle: planMaybeSingle }) }) },
      ],
      installments: [{ select: () => ({ eq: currentEq }) }],
      enrollments: [
        { select: () => ({ eq: () => ({ maybeSingle: programMaybeSingle }) }) },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await addInstallmentToPlan("plan-1", {
      label: null,
      amount: "5000.00",
      dueDate: FUTURE_DATE,
    });
    expect(result).toEqual({
      ok: false,
      error: "This program does not permit splitting fees into installments.",
    });
  });

  it("inserts the new row with sequence = max existing + 1 and recomputes the plan total", async () => {
    const planMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "plan-1", enrollment_id: "enr-1" }, error: null });
    const currentEq = vi
      .fn()
      .mockResolvedValue({ data: [{ sequence: 1 }, { sequence: 2 }], error: null });
    const programMaybeSingle = vi.fn().mockResolvedValue({
      data: { program: { installments_allowed: true } },
      error: null,
    });
    const insertSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "inst-3" }, error: null });
    let insertedPayload: unknown;
    const recomputeSelectEq = vi.fn().mockResolvedValue({
      data: [{ amount: "10000.00" }, { amount: "20000.00" }, { amount: "5000.00" }],
      error: null,
    });
    const recomputeUpdateEq = vi.fn().mockResolvedValue({ error: null });

    const from = createFromMock({
      payment_plans: [
        { select: () => ({ eq: () => ({ maybeSingle: planMaybeSingle }) }) },
        { update: () => ({ eq: recomputeUpdateEq }) },
      ],
      installments: [
        { select: () => ({ eq: currentEq }) },
        {
          insert: (payload: unknown) => {
            insertedPayload = payload;
            return { select: () => ({ single: insertSingle }) };
          },
        },
        { select: () => ({ eq: recomputeSelectEq }) },
      ],
      enrollments: [
        { select: () => ({ eq: () => ({ maybeSingle: programMaybeSingle }) }) },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await addInstallmentToPlan("plan-1", {
      label: "Installment 3",
      amount: "5000.00",
      dueDate: FUTURE_DATE,
    });
    expect(result).toEqual({ ok: true, data: { id: "inst-3" } });
    expect(insertedPayload).toMatchObject({ sequence: 3, amount: "5000.00" });
    expect(recomputeUpdateEq).toHaveBeenCalledWith("id", "plan-1");
  });
});

describe("editInstallment", () => {
  it("rejects editing an installment whose derived status is 'paid'", async () => {
    const currentMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "inst-1",
        payment_plan_id: "plan-1",
        due_date: FUTURE_DATE,
        status: "upcoming",
        amount: "10000.00",
        amount_paid_cache: "10000.00",
      },
      error: null,
    });
    const from = createFromMock({
      installments: [
        { select: () => ({ eq: () => ({ maybeSingle: currentMaybeSingle }) }) },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await editInstallment("inst-1", {
      label: null,
      amount: "5000.00",
      dueDate: FUTURE_DATE,
    });
    expect(result).toEqual({
      ok: false,
      error: "A fully paid installment cannot be edited.",
    });
  });

  it("updates the row and recomputes the plan total", async () => {
    const currentMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "inst-1",
        payment_plan_id: "plan-1",
        due_date: FUTURE_DATE,
        status: "upcoming",
        amount: "10000.00",
        amount_paid_cache: "0.00",
      },
      error: null,
    });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const recomputeSelectEq = vi.fn().mockResolvedValue({
      data: [{ amount: "12000.00" }],
      error: null,
    });
    const recomputeUpdateEq = vi.fn().mockResolvedValue({ error: null });

    const from = createFromMock({
      installments: [
        { select: () => ({ eq: () => ({ maybeSingle: currentMaybeSingle }) }) },
        { update: () => ({ eq: updateEq }) },
        { select: () => ({ eq: recomputeSelectEq }) },
      ],
      payment_plans: [{ update: () => ({ eq: recomputeUpdateEq }) }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await editInstallment("inst-1", {
      label: "Renamed",
      amount: "12000.00",
      dueDate: FUTURE_DATE,
    });
    expect(result).toEqual({ ok: true, data: { id: "inst-1" } });
    expect(recomputeUpdateEq).toHaveBeenCalledWith("id", "plan-1");
  });
});

describe("waiveInstallment", () => {
  it("rejects waiving an installment whose derived status is 'paid'", async () => {
    const currentMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "inst-1",
        amount: "10000.00",
        due_date: FUTURE_DATE,
        status: "upcoming",
        amount_paid_cache: "10000.00",
      },
      error: null,
    });
    const from = createFromMock({
      installments: [
        { select: () => ({ eq: () => ({ maybeSingle: currentMaybeSingle }) }) },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await waiveInstallment("inst-1");
    expect(result).toEqual({
      ok: false,
      error: "A fully paid installment cannot be waived.",
    });
  });

  it("sets status to 'waived' for an unpaid installment", async () => {
    const currentMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "inst-1",
        amount: "10000.00",
        due_date: PAST_DATE,
        status: "upcoming",
        amount_paid_cache: "0.00",
      },
      error: null,
    });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    let updatedPayload: unknown;

    const from = createFromMock({
      installments: [
        { select: () => ({ eq: () => ({ maybeSingle: currentMaybeSingle }) }) },
        {
          update: (payload: unknown) => {
            updatedPayload = payload;
            return { eq: updateEq };
          },
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await waiveInstallment("inst-1");
    expect(result).toEqual({ ok: true, data: { id: "inst-1" } });
    expect(updatedPayload).toEqual({ status: "waived" });
  });
});

describe("removeInstallment", () => {
  it("rejects removal when a payment references the installment", async () => {
    const currentMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "inst-1", payment_plan_id: "plan-1" },
      error: null,
    });
    const paymentsLimit = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "pay-1" }], error: null });

    const from = createFromMock({
      installments: [
        { select: () => ({ eq: () => ({ maybeSingle: currentMaybeSingle }) }) },
      ],
      payments: [{ select: () => ({ eq: () => ({ limit: paymentsLimit }) }) }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await removeInstallment("inst-1");
    expect(result).toEqual({
      ok: false,
      error: "This installment has a payment recorded against it and cannot be removed.",
    });
  });

  it("deletes the row and recomputes the plan total when nothing references it", async () => {
    const currentMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "inst-1", payment_plan_id: "plan-1" },
      error: null,
    });
    const paymentsLimit = vi.fn().mockResolvedValue({ data: [], error: null });
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const recomputeSelectEq = vi.fn().mockResolvedValue({ data: [], error: null });
    const recomputeUpdateEq = vi.fn().mockResolvedValue({ error: null });

    const from = createFromMock({
      installments: [
        { select: () => ({ eq: () => ({ maybeSingle: currentMaybeSingle }) }) },
        { delete: () => ({ eq: deleteEq }) },
        { select: () => ({ eq: recomputeSelectEq }) },
      ],
      payments: [{ select: () => ({ eq: () => ({ limit: paymentsLimit }) }) }],
      payment_plans: [{ update: () => ({ eq: recomputeUpdateEq }) }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await removeInstallment("inst-1");
    expect(result).toEqual({ ok: true, data: { id: "inst-1" } });
    expect(recomputeUpdateEq).toHaveBeenCalledWith("id", "plan-1");
  });
});
