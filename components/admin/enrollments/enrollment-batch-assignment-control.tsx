"use client";

import { useActionState } from "react";
import {
  assignEnrollmentBatchAction,
  type EnrollmentBatchAssignmentFormState,
} from "@/lib/actions/enrollments";
import type { BatchOption } from "@/lib/data/enrollments";
import { Button } from "@/components/ui/button";

const initialState: EnrollmentBatchAssignmentFormState = {};

// Approved business rule (Phase 9 manual-acceptance correction, Sept 2026):
// a Batch may only be assigned or changed while the Enrollment is Lead or
// Applicant — this control is only ever rendered by the caller in that
// case (see app/admin/enrollments/[id]/page.tsx's canAssignBatch check);
// server-side validation (assignEnrollmentBatch) remains authoritative
// regardless.
export function EnrollmentBatchAssignmentControl({
  enrollmentId,
  currentBatchId,
  batchOptions,
}: {
  enrollmentId: string;
  currentBatchId: string | null;
  batchOptions: BatchOption[];
}) {
  const boundAction = assignEnrollmentBatchAction.bind(null, enrollmentId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <select
        name="batchId"
        defaultValue={currentBatchId ?? ""}
        aria-invalid={!!state.fieldErrors?.batchId}
        className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
      >
        <option value="">Not yet batch-assigned</option>
        {batchOptions.map((batch) => (
          <option key={batch.id} value={batch.id}>
            {batch.name}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? "Saving..." : currentBatchId ? "Change batch" : "Assign batch"}
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
