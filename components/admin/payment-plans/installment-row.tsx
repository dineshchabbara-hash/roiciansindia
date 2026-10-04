"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  editInstallmentAction,
  removeInstallmentAction,
  waiveInstallmentAction,
  type PaymentPlanFormState,
} from "@/lib/actions/payment-plans";
import type { InstallmentStatus } from "@/lib/domain/payment-plans";
import type { InstallmentRow as InstallmentRowData } from "@/lib/data/payment-plans";

const initialState: PaymentPlanFormState = {};

const STATUS_LABELS: Record<InstallmentStatus, string> = {
  upcoming: "Upcoming",
  due: "Due",
  partially_paid: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  waived: "Waived",
};

/**
 * One existing installment line. Three independent, sibling forms (HTML
 * forbids nesting a <form> inside another, so Edit/Waive/Remove cannot live
 * inside one shared row-level form) — matches this codebase's established
 * one-control-per-form convention (EnrollmentStatusControl,
 * EnrollmentBatchAssignmentControl) rather than one large multi-row form.
 * Waive/Remove are only offered when `installment.editable` (derived
 * status isn't 'paid' — see lib/domain/payment-plans.ts); the server
 * re-checks this independently regardless, per "never rely on UI hiding."
 */
export function InstallmentRow({
  installment,
  enrollmentId,
}: {
  installment: InstallmentRowData;
  enrollmentId: string;
}) {
  const boundEdit = editInstallmentAction.bind(null, installment.id, enrollmentId);
  const [editState, editFormAction, editPending] = useActionState(
    boundEdit,
    initialState,
  );

  const boundWaive = waiveInstallmentAction.bind(null, installment.id, enrollmentId);
  const [waiveState, waiveFormAction, waivePending] = useActionState(
    boundWaive,
    initialState,
  );

  const boundRemove = removeInstallmentAction.bind(null, installment.id, enrollmentId);
  const [removeState, removeFormAction, removePending] = useActionState(
    boundRemove,
    initialState,
  );

  return (
    <li className="flex flex-col gap-2 border-b pb-3 last:border-0 last:pb-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <form
          action={editFormAction}
          className="flex flex-1 flex-wrap items-center gap-2"
        >
          <span className="text-muted-foreground w-6 shrink-0 text-xs">
            #{installment.sequence}
          </span>
          <Input
            name="label"
            defaultValue={installment.label ?? ""}
            placeholder="Label"
            disabled={!installment.editable}
            className="w-40"
            aria-label={`Label for installment ${installment.sequence}`}
          />
          <Input
            name="amount"
            defaultValue={installment.amount}
            inputMode="decimal"
            disabled={!installment.editable}
            className="w-28"
            aria-label={`Amount for installment ${installment.sequence}`}
          />
          <Input
            name="dueDate"
            type="date"
            defaultValue={installment.dueDate}
            disabled={!installment.editable}
            className="w-40"
            aria-label={`Due date for installment ${installment.sequence}`}
          />
          <span className="text-muted-foreground text-xs">
            {STATUS_LABELS[installment.displayStatus]}
          </span>
          {installment.editable && (
            <Button type="submit" variant="outline" size="sm" disabled={editPending}>
              {editPending ? "Saving..." : "Save"}
            </Button>
          )}
        </form>

        {installment.editable && (
          <div className="flex shrink-0 gap-2">
            <form action={waiveFormAction}>
              <Button type="submit" variant="ghost" size="sm" disabled={waivePending}>
                {waivePending ? "Waiving..." : "Waive"}
              </Button>
            </form>
            <form action={removeFormAction}>
              <Button type="submit" variant="ghost" size="sm" disabled={removePending}>
                {removePending ? "Removing..." : "Remove"}
              </Button>
            </form>
          </div>
        )}
      </div>
      {editState.formError && (
        <p role="alert" className="text-destructive text-xs">
          {editState.formError}
        </p>
      )}
      {waiveState.formError && (
        <p role="alert" className="text-destructive text-xs">
          {waiveState.formError}
        </p>
      )}
      {removeState.formError && (
        <p role="alert" className="text-destructive text-xs">
          {removeState.formError}
        </p>
      )}
    </li>
  );
}
