"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createPaymentPlanAction,
  type PaymentPlanFormState,
} from "@/lib/actions/payment-plans";

const initialState: PaymentPlanFormState = {};

/**
 * No plan exists yet for this Enrollment — a worked-example-shaped form
 * (IMPLEMENTATION_PLAN.md Phase 14 DoD: "registration + two installments"),
 * starting with one row and letting Admin add more client-side before
 * submit. Every row's label/amount/dueDate use plain repeated field names
 * (not array-bracket syntax), parsed server-side by
 * parseCreatePaymentPlanFormData via FormData.getAll — the same
 * progressive-enhancement, repeated-field-group convention
 * components/admin/attendance/attendance-roster-form.tsx already
 * established. No totalAmount field: the plan total is always computed
 * server-side as the sum of these rows (lib/domain/payment-plans.ts).
 */
export function CreatePaymentPlanForm({ enrollmentId }: { enrollmentId: string }) {
  const boundAction = createPaymentPlanAction.bind(null, enrollmentId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  // Client-side-only row keys for React's own list reconciliation — never
  // sent to the server (the server reads rows by submission order via
  // FormData.getAll, not by these keys).
  const [rowKeys, setRowKeys] = useState<number[]>([0]);
  const [nextKey, setNextKey] = useState(1);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {rowKeys.map((key, index) => (
          <li key={key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              name="label"
              placeholder={index === 0 ? "e.g. Registration" : `Installment ${index + 1}`}
              className="sm:w-48"
              aria-label="Installment label"
            />
            <Input
              name="amount"
              placeholder="Amount"
              inputMode="decimal"
              className="sm:w-32"
              aria-label="Installment amount"
            />
            <Input
              name="dueDate"
              type="date"
              className="sm:w-40"
              aria-label="Installment due date"
            />
            {rowKeys.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRowKeys((keys) => keys.filter((k) => k !== key))}
              >
                Remove row
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => {
          setRowKeys((keys) => [...keys, nextKey]);
          setNextKey((n) => n + 1);
        }}
      >
        + Add installment
      </Button>

      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Creating..." : "Create payment plan"}
      </Button>
    </form>
  );
}
