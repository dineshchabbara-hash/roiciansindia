"use client";

import { useActionState } from "react";
import { setProgramStatusAction, type ProgramFormState } from "@/lib/actions/programs";
import { PROGRAM_STATUSES, type ProgramStatus } from "@/lib/domain/programs";
import { Button } from "@/components/ui/button";

const initialState: ProgramFormState = {};

// All 4 values the programs.status CHECK constraint allows, freely
// selectable — there is no documented transition lifecycle to enforce
// (unlike, say, Batch's Draft -> Upcoming -> ... in REQUIREMENTS.md FR-23),
// same as Student/Trainer's status controls.
const STATUS_LABELS: Record<ProgramStatus, string> = {
  draft: "Draft",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

export function ProgramStatusControl({
  programId,
  currentStatus,
}: {
  programId: string;
  currentStatus: ProgramStatus;
}) {
  const boundAction = setProgramStatusAction.bind(null, programId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <select
        name="status"
        defaultValue={currentStatus}
        className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
      >
        {PROGRAM_STATUSES.map((status) => (
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
