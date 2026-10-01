"use client";

import { useActionState } from "react";
import {
  updateClassSessionStatusAction,
  type ClassSessionStatusFormState,
} from "@/lib/actions/class-sessions";
import {
  CLASS_SESSION_STATUSES,
  type ClassSessionStatus,
} from "@/lib/domain/class-sessions";
import { Button } from "@/components/ui/button";

const initialState: ClassSessionStatusFormState = {};

// All 4 values the class_sessions.status CHECK constraint allows (FR-60),
// freely selectable — same "no transition-order enforcement" precedent as
// components/admin/batches/batch-status-control.tsx: no trigger/constraint
// in the schema restricts status changes, so this doesn't invent one.
const STATUS_LABELS: Record<ClassSessionStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
};

export function ClassSessionStatusControl({
  batchId,
  sessionId,
  currentStatus,
}: {
  batchId: string;
  sessionId: string;
  currentStatus: ClassSessionStatus;
}) {
  const boundAction = updateClassSessionStatusAction.bind(null, batchId, sessionId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <select
        name="status"
        defaultValue={currentStatus}
        className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
      >
        {CLASS_SESSION_STATUSES.map((status) => (
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
