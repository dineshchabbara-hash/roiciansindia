"use client";

import { useActionState } from "react";
import {
  setEnrollmentStatusAction,
  type EnrollmentStatusFormState,
} from "@/lib/actions/enrollments";
import { ENROLLMENT_STATUSES, type EnrollmentStatus } from "@/lib/domain/enrollments";
import { Button } from "@/components/ui/button";

const initialState: EnrollmentStatusFormState = {};

// All 8 values the enrollments.status CHECK constraint allows, freely
// selectable — no trigger/constraint in the schema restricts transition
// order, and no other status control in this codebase (Batch/Program/
// Student/Trainer) enforces one either, so this doesn't invent one.
// ("Registered" was removed — Phase 9 manual-acceptance correction,
// Sept 2026 — Registered and Enrolled are not separate stages for this
// workflow.)
const STATUS_LABELS: Record<EnrollmentStatus, string> = {
  lead: "Lead",
  applicant: "Applicant",
  enrolled: "Enrolled",
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
};

export function EnrollmentStatusControl({
  enrollmentId,
  currentStatus,
}: {
  enrollmentId: string;
  currentStatus: EnrollmentStatus;
}) {
  const boundAction = setEnrollmentStatusAction.bind(null, enrollmentId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <select
        name="status"
        defaultValue={currentStatus}
        className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
      >
        {ENROLLMENT_STATUSES.map((status) => (
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
