import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import { sumPaise, toPaise } from "@/lib/domain/money";
import {
  deriveInstallmentDisplayStatus,
  isInstallmentEditable,
  type InstallmentStatus,
} from "@/lib/domain/payment-plans";
import type {
  AddInstallmentInput,
  CreatePaymentPlanInput,
  EditInstallmentInput,
} from "@/lib/validation/payment-plans";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[payment-plans data] ${message}:`, error);
  return { ok: false, error: message };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export type InstallmentRow = {
  id: string;
  sequence: number;
  label: string | null;
  amount: string;
  dueDate: string;
  storedStatus: InstallmentStatus;
  displayStatus: InstallmentStatus;
  editable: boolean;
};

export type PaymentPlanRow = {
  id: string;
  enrollmentId: string;
  totalAmount: string;
  installments: InstallmentRow[];
};

function toInstallmentRow(row: {
  id: string;
  sequence: number;
  label: string | null;
  amount: string;
  due_date: string;
  status: InstallmentStatus;
  amount_paid_cache: string;
}): InstallmentRow {
  const displayStatus = deriveInstallmentDisplayStatus({
    status: row.status,
    dueDate: row.due_date,
    amountPaise: toPaise(row.amount),
    amountPaidPaise: toPaise(row.amount_paid_cache),
    today: todayIso(),
  });
  return {
    id: row.id,
    sequence: row.sequence,
    label: row.label,
    amount: row.amount,
    dueDate: row.due_date,
    storedStatus: row.status,
    displayStatus,
    editable: isInstallmentEditable(displayStatus),
  };
}

// ---------------------------------------------------------------------------
// Read — a plan is optional (one-to-zero-or-one with its Enrollment); "no
// plan yet" is a valid, common state, not an error.

export async function getPaymentPlanForEnrollment(
  enrollmentId: string,
): Promise<DataResult<PaymentPlanRow | null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: plan, error: planError } = await supabase
      .from("payment_plans")
      .select("id, enrollment_id, total_amount")
      .eq("enrollment_id", enrollmentId)
      .maybeSingle();
    if (planError) throw planError;
    if (!plan) return { ok: true, data: null };

    const { data: installments, error: installmentsError } = await supabase
      .from("installments")
      .select("id, sequence, label, amount, due_date, status, amount_paid_cache")
      .eq("payment_plan_id", plan.id)
      .order("sequence", { ascending: true });
    if (installmentsError) throw installmentsError;

    return {
      ok: true,
      data: {
        id: plan.id,
        enrollmentId: plan.enrollment_id,
        totalAmount: plan.total_amount,
        installments: (
          (installments ?? []) as unknown as Array<{
            id: string;
            sequence: number;
            label: string | null;
            amount: string;
            due_date: string;
            status: InstallmentStatus;
            amount_paid_cache: string;
          }>
        ).map(toInstallmentRow),
      },
    };
  } catch (error) {
    return fail("Could not load the payment plan.", error);
  }
}

// Whether this Enrollment's Program permits an installment (>1 line)
// schedule — the one existing gating flag (programs.installments_allowed,
// 20260101000005_catalog_tables.sql) Phase 9 defined but never enforced
// anywhere; Phase 14 is the first phase to read it. A single-line "plan"
// (full payment recorded as one line) is never gated by this flag — the
// flag's own name describes splitting into installments, not whether an
// Enrollment may have a payment_plans row at all.
async function getInstallmentsAllowedForEnrollment(
  supabase: SupabaseServerClient,
  enrollmentId: string,
): Promise<DataResult<boolean>> {
  try {
    const { data, error } = await supabase
      .from("enrollments")
      .select("program:programs(installments_allowed)")
      .eq("id", enrollmentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "Enrollment not found." };
    const row = data as unknown as { program: { installments_allowed: boolean } | null };
    return { ok: true, data: row.program?.installments_allowed ?? true };
  } catch (error) {
    return fail(
      "Could not check whether installments are allowed for this program.",
      error,
    );
  }
}

// payment_plans.total_amount is a derived cache, never a form field (see
// lib/domain/payment-plans.ts's header comment) — recomputed here from
// sum(installments.amount) after every installment create/edit/remove,
// the same "never let a cache drift from its source rows" discipline
// enrollments.amount_paid_cache/outstanding_balance_cache already use
// elsewhere in this codebase.
async function recomputePlanTotal(
  supabase: SupabaseServerClient,
  planId: string,
): Promise<DataResult<string>> {
  try {
    const { data, error } = await supabase
      .from("installments")
      .select("amount")
      .eq("payment_plan_id", planId);
    if (error) throw error;

    const totalPaise = sumPaise(
      ((data ?? []) as Array<{ amount: string }>).map((r) => r.amount),
    );
    const totalAmount = (totalPaise / 100).toFixed(2);

    const { error: updateError } = await supabase
      .from("payment_plans")
      .update({ total_amount: totalAmount })
      .eq("id", planId);
    if (updateError) throw updateError;

    return { ok: true, data: totalAmount };
  } catch (error) {
    return fail("Could not recompute the payment plan total.", error);
  }
}

// ---------------------------------------------------------------------------
// Create — only when no plan exists yet (payment_plans.enrollment_id is
// unique; this pre-check exists only for a clean error message, the unique
// constraint is still the real backstop under a race).

export async function createPaymentPlanForEnrollment(
  enrollmentId: string,
  input: CreatePaymentPlanInput,
): Promise<DataResult<{ id: string }>> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: existing, error: existingError } = await supabase
      .from("payment_plans")
      .select("id")
      .eq("enrollment_id", enrollmentId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return { ok: false, error: "This enrollment already has a payment plan." };
    }

    if (input.installments.length > 1) {
      const allowed = await getInstallmentsAllowedForEnrollment(supabase, enrollmentId);
      if (!allowed.ok) return allowed;
      if (!allowed.data) {
        return {
          ok: false,
          error: "This program does not permit splitting fees into installments.",
        };
      }
    }

    const totalAmountPaise = sumPaise(input.installments.map((i) => i.amount));
    const totalAmount = (totalAmountPaise / 100).toFixed(2);

    const { data: plan, error: planError } = await supabase
      .from("payment_plans")
      .insert({ enrollment_id: enrollmentId, total_amount: totalAmount })
      .select("id")
      .single();
    if (planError || !plan) throw planError ?? new Error("Insert returned no row.");

    const { error: installmentsError } = await supabase.from("installments").insert(
      input.installments.map((line, index) => ({
        payment_plan_id: plan.id,
        sequence: index + 1,
        label: line.label,
        amount: line.amount,
        due_date: line.dueDate,
      })),
    );
    if (installmentsError) {
      // Never leave an empty, orphaned plan behind — exact-id cleanup of
      // only the row this call itself just created, same discipline as the
      // E2E fixtures' own exact-id-only teardown.
      await supabase.from("payment_plans").delete().eq("id", plan.id);
      throw installmentsError;
    }

    return { ok: true, data: { id: plan.id } };
  } catch (error) {
    return fail("Could not create the payment plan. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Add one installment to an existing plan — its own small mutation
// (matches this codebase's one-control-per-form convention).

export async function addInstallmentToPlan(
  planId: string,
  input: AddInstallmentInput,
): Promise<DataResult<{ id: string }>> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: plan, error: planError } = await supabase
      .from("payment_plans")
      .select("id, enrollment_id")
      .eq("id", planId)
      .maybeSingle();
    if (planError) throw planError;
    if (!plan) return { ok: false, error: "Payment plan not found." };

    const { data: current, error: currentError } = await supabase
      .from("installments")
      .select("sequence")
      .eq("payment_plan_id", planId);
    if (currentError) throw currentError;
    const rows = (current ?? []) as Array<{ sequence: number }>;

    if (rows.length >= 1) {
      // Adding a second (or later) line — this enrollment's plan is now
      // genuinely "installments", so the gating flag applies. A plan that
      // already has >1 line was already cleared for this at the point the
      // 2nd line was added, so this only re-checks on the way from 1 -> 2+.
      const allowed = await getInstallmentsAllowedForEnrollment(
        supabase,
        plan.enrollment_id,
      );
      if (!allowed.ok) return allowed;
      if (!allowed.data) {
        return {
          ok: false,
          error: "This program does not permit splitting fees into installments.",
        };
      }
    }

    const maxSequence = Math.max(0, ...rows.map((r) => r.sequence));
    const { data: inserted, error: insertError } = await supabase
      .from("installments")
      .insert({
        payment_plan_id: planId,
        sequence: maxSequence + 1,
        label: input.label,
        amount: input.amount,
        due_date: input.dueDate,
      })
      .select("id")
      .single();
    if (insertError || !inserted)
      throw insertError ?? new Error("Insert returned no row.");

    const recompute = await recomputePlanTotal(supabase, planId);
    if (!recompute.ok) return recompute;

    return { ok: true, data: { id: inserted.id } };
  } catch (error) {
    return fail("Could not add the installment. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Edit one existing installment's own fields.

export async function editInstallment(
  installmentId: string,
  input: EditInstallmentInput,
): Promise<DataResult<{ id: string }>> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: current, error: currentError } = await supabase
      .from("installments")
      .select("id, payment_plan_id, due_date, status, amount, amount_paid_cache")
      .eq("id", installmentId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return { ok: false, error: "Installment not found." };

    const displayStatus = deriveInstallmentDisplayStatus({
      status: current.status as InstallmentStatus,
      dueDate: current.due_date,
      amountPaise: toPaise(current.amount),
      amountPaidPaise: toPaise(current.amount_paid_cache),
      today: todayIso(),
    });
    if (!isInstallmentEditable(displayStatus)) {
      return { ok: false, error: "A fully paid installment cannot be edited." };
    }

    const { error: updateError } = await supabase
      .from("installments")
      .update({ label: input.label, amount: input.amount, due_date: input.dueDate })
      .eq("id", installmentId);
    if (updateError) throw updateError;

    const recompute = await recomputePlanTotal(supabase, current.payment_plan_id);
    if (!recompute.ok) return recompute;

    return { ok: true, data: { id: installmentId } };
  } catch (error) {
    return fail("Could not update the installment. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Waive — an explicit Admin business decision (see
// lib/domain/payment-plans.ts's own header comment); the one status value
// this phase ever writes directly. Does not change the installment's own
// amount, so the plan total is unaffected — "waived" means "forgiven," not
// "struck from the schedule" (REQUIREMENTS.md/IMPLEMENTATION_PLAN.md define
// no "net of waivers" total, so none is invented here).

export async function waiveInstallment(
  installmentId: string,
): Promise<DataResult<{ id: string }>> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: current, error: currentError } = await supabase
      .from("installments")
      .select("id, amount, due_date, status, amount_paid_cache")
      .eq("id", installmentId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return { ok: false, error: "Installment not found." };

    const displayStatus = deriveInstallmentDisplayStatus({
      status: current.status as InstallmentStatus,
      dueDate: current.due_date,
      amountPaise: toPaise(current.amount),
      amountPaidPaise: toPaise(current.amount_paid_cache),
      today: todayIso(),
    });
    if (displayStatus === "paid") {
      return { ok: false, error: "A fully paid installment cannot be waived." };
    }

    const { error } = await supabase
      .from("installments")
      .update({ status: "waived" })
      .eq("id", installmentId);
    if (error) throw error;

    return { ok: true, data: { id: installmentId } };
  } catch (error) {
    return fail("Could not waive the installment. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Remove — hard delete, but only for an installment nothing has ever been
// paid against (checked below by exact id, via the real payments table —
// never inferred from status alone). Unlike Attendance's conservative
// no-hard-delete stance, an unpaid installment row has no financial history
// to lose: nothing in `payments` can reference it yet by definition of
// "unpaid", so deleting it destroys a draft schedule line, not a
// transaction record.

export async function removeInstallment(
  installmentId: string,
): Promise<DataResult<{ id: string }>> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: current, error: currentError } = await supabase
      .from("installments")
      .select("id, payment_plan_id")
      .eq("id", installmentId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return { ok: false, error: "Installment not found." };

    const { data: referencingPayments, error: paymentsError } = await supabase
      .from("payments")
      .select("id")
      .eq("installment_id", installmentId)
      .limit(1);
    if (paymentsError) throw paymentsError;
    if ((referencingPayments ?? []).length > 0) {
      return {
        ok: false,
        error:
          "This installment has a payment recorded against it and cannot be removed.",
      };
    }

    const { error } = await supabase
      .from("installments")
      .delete()
      .eq("id", installmentId);
    if (error) throw error;

    const recompute = await recomputePlanTotal(supabase, current.payment_plan_id);
    if (!recompute.ok) return recompute;

    return { ok: true, data: { id: installmentId } };
  } catch (error) {
    return fail("Could not remove the installment. Please try again.", error);
  }
}
