"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AssignmentFormState } from "@/lib/actions/assignments";

const initialState: AssignmentFormState = {};

/**
 * Generic review form — the parent page binds its own role-specific action
 * (reviewSubmissionAsAdminAction / reviewMySubmissionAction), so this
 * component never itself decides who is reviewing. Only the two schema-
 * defined reviewer outcomes are offered (`reviewed` / `resubmission_
 * requested`) — REQUIREMENTS §21/FR-82: marks/feedback are conditional on
 * the pre-existing approved assessment model (the schema's own marks/
 * trainer_feedback columns), nothing invented beyond them.
 */
export function SubmissionReviewForm({
  action,
  maxMarks,
  currentMarks,
  currentFeedback,
}: {
  action: (
    prevState: AssignmentFormState,
    formData: FormData,
  ) => Promise<AssignmentFormState>;
  maxMarks: number | null;
  currentMarks: number | null;
  currentFeedback: string | null;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          name="marks"
          type="number"
          min="0"
          max={maxMarks ?? undefined}
          step="0.01"
          placeholder={maxMarks !== null ? `Marks (max ${maxMarks})` : "Marks"}
          defaultValue={currentMarks ?? ""}
          className="w-40"
        />
      </div>
      <Input
        name="trainerFeedback"
        placeholder="Feedback (optional)"
        defaultValue={currentFeedback ?? ""}
      />
      <div className="flex items-center gap-2">
        <select
          name="nextStatus"
          defaultValue="reviewed"
          className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
        >
          <option value="reviewed">Mark as reviewed</option>
          <option value="resubmission_requested">Request resubmission</option>
        </select>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving..." : "Save review"}
        </Button>
      </div>
      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}
      {state.success && (
        <p className="text-sm text-green-700 dark:text-green-400">Review saved</p>
      )}
    </form>
  );
}
