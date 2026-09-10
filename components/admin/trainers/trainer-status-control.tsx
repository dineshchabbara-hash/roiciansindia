"use client";

import { useActionState } from "react";
import { setTrainerStatusAction, type TrainerFormState } from "@/lib/actions/trainers";
import { Button } from "@/components/ui/button";

const initialState: TrainerFormState = {};

// Only 'active' | 'inactive' — the trainers table's own CHECK constraint
// has no 'archived' value, unlike students. See lib/domain/trainers.ts's
// TRAINER_STATUSES comment for why this deliberately isn't a 3-value model.
const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

export function TrainerStatusControl({
  trainerId,
  currentStatus,
}: {
  trainerId: string;
  currentStatus: "active" | "inactive";
}) {
  const boundAction = setTrainerStatusAction.bind(null, trainerId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <select
        name="status"
        defaultValue={currentStatus}
        className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
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
