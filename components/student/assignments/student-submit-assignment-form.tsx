"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AssignmentFormState } from "@/lib/actions/assignments";
import { submitMyAssignmentAction } from "@/lib/actions/student-assignments";
import {
  isAssignmentExtensionAllowed,
  isAssignmentFileSizeAllowed,
  assignmentFileSizeTooLargeError,
  ASSIGNMENT_FILE_TYPE_ERROR,
  ASSIGNMENT_MAX_DOCUMENT_SIZE_LABEL,
  ASSIGNMENT_MAX_IMAGE_SIZE_LABEL,
} from "@/lib/domain/assignments";

const initialState: AssignmentFormState = {};

export function StudentSubmitAssignmentForm({
  assignmentId,
  enrollmentId,
  currentTextResponse,
  hasExistingFile,
}: {
  assignmentId: string;
  enrollmentId: string;
  currentTextResponse: string | null;
  hasExistingFile: boolean;
}) {
  const boundAction = submitMyAssignmentAction.bind(null, assignmentId, enrollmentId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);
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
      <textarea
        name="textResponse"
        placeholder="Your response (optional if attaching a file)"
        defaultValue={currentTextResponse ?? ""}
        rows={3}
        className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs"
      />
      <div className="flex items-center gap-3">
        <label
          htmlFor={`submissionFile-${assignmentId}`}
          className="border-input hover:bg-accent focus-within:ring-ring inline-flex h-9 w-fit cursor-pointer items-center rounded-md border bg-transparent px-3 text-sm font-medium shadow-xs focus-within:ring-2 focus-within:ring-offset-2"
        >
          {hasExistingFile ? "Replace file" : "Attach file"}
          <input
            id={`submissionFile-${assignmentId}`}
            type="file"
            name="file"
            className="sr-only"
            onChange={(event) => {
              setSelectedFileName(event.target.files?.[0]?.name ?? null);
              setClientFileError(null);
            }}
          />
        </label>
        <span className="text-muted-foreground text-sm">
          {selectedFileName ??
            (hasExistingFile ? "Keeping existing file" : "No file chosen")}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        Documents up to {ASSIGNMENT_MAX_DOCUMENT_SIZE_LABEL}, images up to{" "}
        {ASSIGNMENT_MAX_IMAGE_SIZE_LABEL}.
      </p>

      {clientFileError && <p className="text-destructive text-sm">{clientFileError}</p>}
      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}
      {state.success && (
        <p className="text-sm text-green-700 dark:text-green-400">Submitted</p>
      )}

      <Button type="submit" size="sm" disabled={isPending} className="w-fit">
        {isPending ? "Submitting..." : "Submit"}
      </Button>
    </form>
  );
}
