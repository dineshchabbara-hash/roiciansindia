"use client";

import { useActionState } from "react";
import { setBatchStatusAction, type BatchFormState } from "@/lib/actions/batches";
import { BATCH_STATUSES, type BatchStatus } from "@/lib/domain/batches";
import { Button } from "@/components/ui/button";

const initialState: BatchFormState = {};

// All 6 values the batches.status CHECK constraint allows, freely
// selectable — REQUIREMENTS.md FR-23 documents an intended progression
// (Draft -> Upcoming -> Active -> Completed/Cancelled -> Archived) but the
// schema has no trigger/constraint enforcing transition order, and no
// other status control in this codebase (Program/Student/Trainer) enforces
// one either, so this doesn't invent one.
const STATUS_LABELS: Record<BatchStatus, string> = {
  draft: "Draft",
  upcoming: "Upcoming",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  archived: "Archived",
};

export function BatchStatusControl({
  batchId,
  currentStatus,
}: {
  batchId: string;
  currentStatus: BatchStatus;
}) {
  const boundAction = setBatchStatusAction.bind(null, batchId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <select
        name="status"
        defaultValue={currentStatus}
        className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
      >
        {BATCH_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? "Updating..." : "Update status"}
      </Button>
      {state.success && (
        <span className="text-sm text-green-700 dark:text-green-400">Saved</span>
      )}
      {state.formError && (
        <span className="text-destructive text-sm">{state.formError}</span>
      )}
    </form>
  );
}
