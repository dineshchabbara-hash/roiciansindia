"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addInstallmentAction,
  type PaymentPlanFormState,
} from "@/lib/actions/payment-plans";

const initialState: PaymentPlanFormState = {};

export function AddInstallmentRowForm({
  planId,
  enrollmentId,
}: {
  planId: string;
  enrollmentId: string;
}) {
  const boundAction = addInstallmentAction.bind(null, planId, enrollmentId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 pt-2">
      <Input
        name="label"
        placeholder="Label (optional)"
        className="w-40"
        aria-label="New installment label"
      />
      <Input
        name="amount"
        placeholder="Amount"
        inputMode="decimal"
        className="w-28"
        aria-label="New installment amount"
      />
      <Input
        name="dueDate"
        type="date"
        className="w-40"
        aria-label="New installment due date"
      />
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? "Adding..." : "+ Add installment"}
      </Button>
      {state.formError && (
        <p role="alert" className="text-destructive w-full text-xs">
          {state.formError}
        </p>
      )}
    </form>
  );
}
