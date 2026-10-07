"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { AssignmentFormState } from "@/lib/actions/assignments";
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from "@/lib/domain/assignments";

const initialState: AssignmentFormState = {};

const STATUS_LABELS: Record<AssignmentStatus, string> = {
  active: "Active",
  closed: "Closed",
};

/**
 * Generic status control — the parent page binds its own role-specific
 * action (updateAssignmentStatusAction / updateMyAssignmentStatusAction),
 * same "action passed in, not decided here" pattern as CreateAssignmentForm
 * and SubmissionReviewForm.
 */
export function AssignmentStatusControl({
  action,
  currentStatus,
}: {
  action: (
    prevState: AssignmentFormState,
    formData: FormData,
  ) => Promise<AssignmentFormState>;
  currentStatus: AssignmentStatus;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <select
        name="status"
        defaultValue={currentStatus}
        className="border-input h-8 rounded-md border bg-transparent px-2 text-xs shadow-xs"
      >
        {ASSIGNMENT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? "Saving..." : "Save"}
      </Button>
      {state.formError && (
        <span role="alert" className="text-destructive text-xs">
          {state.formError}
        </span>
      )}
    </form>
  );
}
