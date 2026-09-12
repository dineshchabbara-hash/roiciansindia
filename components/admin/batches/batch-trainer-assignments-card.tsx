"use client";

import { useActionState } from "react";
import {
  assignTrainerAction,
  unassignTrainerAction,
  type TrainerAssignmentFormState,
} from "@/lib/actions/batches";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { BatchTrainerAssignment } from "@/lib/data/batches";

const initialState: TrainerAssignmentFormState = {};

function UnassignButton({ batchId, trainerId }: { batchId: string; trainerId: string }) {
  const boundAction = unassignTrainerAction.bind(null, batchId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="trainerId" value={trainerId} />
      <Button type="submit" variant="ghost" size="sm" disabled={isPending}>
        {isPending ? "Removing..." : "Unassign"}
      </Button>
      {state.formError && (
        <span className="text-destructive text-xs">{state.formError}</span>
      )}
    </form>
  );
}

/**
 * Admin/Super Admin management of batch_trainers for this batch — assign an
 * existing Trainer, view current assignments (with status so an Admin can
 * see an inactive Trainer before choosing to assign them; no restriction is
 * enforced, since neither the schema nor RLS blocks it — see the Phase 8
 * report), and unassign. Never creates or edits a Trainer profile itself
 * (Phase 6 scope).
 */
export function BatchTrainerAssignmentsCard({
  batchId,
  assignments,
  trainerOptions,
  error,
}: {
  batchId: string;
  assignments?: BatchTrainerAssignment[];
  trainerOptions?: Array<{
    id: string;
    firstName: string;
    lastName: string;
    status: "active" | "inactive";
  }>;
  error?: string;
}) {
  const boundAssignAction = assignTrainerAction.bind(null, batchId);
  const [assignState, assignFormAction, isAssignPending] = useActionState(
    boundAssignAction,
    initialState,
  );

  const assignedTrainerIds = new Set((assignments ?? []).map((a) => a.trainerId));
  const availableTrainers = (trainerOptions ?? []).filter(
    (t) => !assignedTrainerIds.has(t.id),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assigned Trainers</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : (
          <>
            {!assignments || assignments.length === 0 ? (
              <p className="text-muted-foreground text-sm">No trainers assigned yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {assignments.map((assignment) => (
                  <li
                    key={assignment.trainerId}
                    className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {assignment.firstName} {assignment.lastName}
                      </span>
                      {assignment.isPrimary && <Badge>Primary</Badge>}
                      {assignment.status === "inactive" && (
                        <Badge variant="warning">Inactive</Badge>
                      )}
                    </div>
                    <UnassignButton batchId={batchId} trainerId={assignment.trainerId} />
                  </li>
                ))}
              </ul>
            )}

            <form action={assignFormAction} className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="trainerId">Assign trainer</Label>
                <select
                  id="trainerId"
                  name="trainerId"
                  defaultValue=""
                  aria-invalid={!!assignState.fieldErrors?.trainerId}
                  className="border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs"
                >
                  <option value="" disabled>
                    Select a trainer
                  </option>
                  {availableTrainers.map((trainer) => (
                    <option key={trainer.id} value={trainer.id}>
                      {trainer.firstName} {trainer.lastName}
                      {trainer.status === "inactive" ? " (inactive)" : ""}
                    </option>
                  ))}
                </select>
                {assignState.fieldErrors?.trainerId && (
                  <p className="text-destructive text-sm">
                    {assignState.fieldErrors.trainerId[0]}
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isPrimary" />
                Primary trainer
              </label>
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={isAssignPending}
              >
                {isAssignPending ? "Assigning..." : "Assign"}
              </Button>
              {assignState.formError && (
                <span className="text-destructive text-sm">{assignState.formError}</span>
              )}
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}
