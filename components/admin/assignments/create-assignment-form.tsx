"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AssignmentFormState } from "@/lib/actions/assignments";
import {
  isAssignmentExtensionAllowed,
  isAssignmentFileSizeAllowed,
  assignmentFileSizeTooLargeError,
  ASSIGNMENT_FILE_TYPE_ERROR,
  ASSIGNMENT_MAX_DOCUMENT_SIZE_LABEL,
  ASSIGNMENT_MAX_IMAGE_SIZE_LABEL,
} from "@/lib/domain/assignments";

const initialState: AssignmentFormState = {};

/**
 * Admin create form — trainerId and moduleId are both re-verified
 * server-side (createBatchAssignmentAction, lib/actions/assignments.ts)
 * against the batch's own assigned trainers / program's own modules, so a
 * tampered option value can never attribute an assignment to an unrelated
 * trainer or module, same posture as Phase 15's own Module-belongs-to-
 * Program finding.
 */
export function CreateAssignmentForm({
  action,
  trainerOptions,
  moduleOptions,
}: {
  action: (
    prevState: AssignmentFormState,
    formData: FormData,
  ) => Promise<AssignmentFormState>;
  trainerOptions?: Array<{ id: string; firstName: string; lastName: string }>;
  moduleOptions?: Array<{ id: string; title: string }>;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [clientFileError, setClientFileError] = useState<string | null>(null);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2"
      noValidate
      onSubmit={(event) => {
        const fileInput = event.currentTarget.elements.namedItem(
          "file",
        ) as HTMLInputElement | null;
        const file = fileInput?.files?.[0];
        if (!file) return;
        if (!isAssignmentExtensionAllowed(file.name)) {
          event.preventDefault();
          setClientFileError(ASSIGNMENT_FILE_TYPE_ERROR);
          return;
        }
        if (!isAssignmentFileSizeAllowed(file.name, file.size)) {
          event.preventDefault();
          setClientFileError(assignmentFileSizeTooLargeError(file.name));
        }
      }}
    >
      <Input name="title" placeholder="Title" required />
      <Input name="description" placeholder="Instructions (optional)" />

      {trainerOptions && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="trainerId" className="text-xs">
            Trainer
          </Label>
          <select
            id="trainerId"
            name="trainerId"
            required
            defaultValue=""
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="" disabled>
              Select a trainer assigned to this batch
            </option>
            {trainerOptions.map((trainer) => (
              <option key={trainer.id} value={trainer.id}>
                {trainer.firstName} {trainer.lastName}
              </option>
            ))}
          </select>
        </div>
      )}

      {moduleOptions && moduleOptions.length > 0 && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="moduleId" className="text-xs">
            Module (optional)
          </Label>
          <select
            id="moduleId"
            name="moduleId"
            defaultValue=""
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="">No module</option>
            {moduleOptions.map((module) => (
              <option key={module.id} value={module.id}>
                {module.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="dueDate" className="text-xs">
          Due date
        </Label>
        <Input id="dueDate" name="dueDate" type="date" required />
      </div>

      <Input
        name="maxMarks"
        type="number"
        min="0"
        step="0.01"
        placeholder="Max marks (optional)"
      />

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <Label
            htmlFor="assignmentFile"
            className="border-input hover:bg-accent focus-within:ring-ring inline-flex h-9 w-fit cursor-pointer items-center rounded-md border bg-transparent px-3 text-sm font-medium shadow-xs focus-within:ring-2 focus-within:ring-offset-2"
          >
            Attach file (optional)
            <input
              id="assignmentFile"
              type="file"
              name="file"
              className="sr-only"
              onChange={(event) => {
                setSelectedFileName(event.target.files?.[0]?.name ?? null);
                setClientFileError(null);
              }}
            />
          </Label>
          <span className="text-muted-foreground text-sm">
            {selectedFileName ?? "No file chosen"}
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          Documents up to {ASSIGNMENT_MAX_DOCUMENT_SIZE_LABEL}, images up to{" "}
          {ASSIGNMENT_MAX_IMAGE_SIZE_LABEL}.
        </p>
      </div>

      {clientFileError && <p className="text-destructive text-sm">{clientFileError}</p>}
      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}
      {state.success && (
        <p className="text-sm text-green-700 dark:text-green-400">Assignment created</p>
      )}

      <Button type="submit" size="sm" disabled={isPending} className="w-fit">
        {isPending ? "Creating..." : "Create assignment"}
      </Button>
    </form>
  );
}
