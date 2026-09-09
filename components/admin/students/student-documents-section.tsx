"use client";

import { useActionState, useState } from "react";
import {
  deleteStudentDocumentAction,
  uploadStudentDocumentAction,
  type DeleteDocumentState,
  type StudentFormState,
} from "@/lib/actions/students";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StudentDocumentRow } from "@/lib/data/students";
import {
  DOCUMENT_FILE_TOO_LARGE_ERROR,
  MAX_DOCUMENT_FILE_SIZE_LABEL,
  formatDisplayTimestamp,
  isDocumentFileSizeAllowed,
} from "@/lib/domain/students";

const initialState: StudentFormState = {};
const initialDeleteState: DeleteDocumentState = {};

function DeleteDocumentButton({
  studentId,
  documentId,
  fileName,
}: {
  studentId: string;
  documentId: string;
  fileName: string;
}) {
  const boundAction = deleteStudentDocumentAction.bind(null, studentId, documentId);
  const [state, formAction, isPending] = useActionState(boundAction, initialDeleteState);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Delete "${fileName}"? This cannot be undone.`)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col items-end gap-1"
    >
      <Button type="submit" variant="ghost" size="sm" disabled={isPending}>
        {isPending ? "Deleting..." : "Delete"}
      </Button>
      {state.formError && (
        <p role="alert" className="text-destructive text-xs">
          {state.formError}
        </p>
      )}
    </form>
  );
}

export function StudentDocumentsSection({
  studentId,
  documents,
}: {
  studentId: string;
  documents: StudentDocumentRow[];
}) {
  const boundUploadAction = uploadStudentDocumentAction.bind(null, studentId);
  const [state, formAction, isPending] = useActionState(boundUploadAction, initialState);

  // React resets a <form action> hooked up via useActionState — including
  // the native file input — once the action resolves (same documented
  // React 19 behavior worked around in student-form.tsx). That's the
  // desired outcome for the input itself (ready for the next upload), but
  // this component's own selectedFileName/clientFileError state doesn't
  // reset with it automatically; without this, a successful upload would
  // leave a stale filename shown next to an actually-empty file input.
  const [priorState, setPriorState] = useState(state);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [clientFileError, setClientFileError] = useState<string | null>(null);
  if (state !== priorState) {
    setPriorState(state);
    if (state.success) {
      setSelectedFileName(null);
      setClientFileError(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-xs">
          Admin/Super Admin only for this phase — never shown to the student portal.
        </p>

        {documents.length === 0 ? (
          <p className="text-muted-foreground text-sm">No documents uploaded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between border-b pb-2 last:border-0"
              >
                <div className="flex flex-col">
                  <span>{doc.documentType}</span>
                  <span className="text-muted-foreground text-xs">{doc.fileName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {formatDisplayTimestamp(doc.createdAt)}
                  </span>
                  <DeleteDocumentButton
                    studentId={studentId}
                    documentId={doc.id}
                    fileName={doc.fileName}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <form
          action={formAction}
          className="flex flex-col gap-2"
          noValidate
          onSubmit={(event) => {
            const fileInput = event.currentTarget.elements.namedItem(
              "file",
            ) as HTMLInputElement | null;
            const file = fileInput?.files?.[0];
            // Blocks the request client-side before it's ever sent, so an
            // oversized file can never reach (and be rejected by) Next's
            // own Server Action body-size transport limit — that
            // rejection happens before uploadStudentDocumentAction runs at
            // all and is what crashed this page for a real file (Phase 5
            // bug). The server independently re-checks the same rule
            // (isDocumentFileSizeAllowed in uploadStudentDocumentAction)
            // for any request that didn't go through this form.
            if (file && !isDocumentFileSizeAllowed(file.size)) {
              event.preventDefault();
              setClientFileError(DOCUMENT_FILE_TOO_LARGE_ERROR);
            }
          }}
        >
          <Input
            name="documentType"
            placeholder="Document type (e.g. ID proof)"
            required
          />

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              {/* The real, accessible file input stays in the DOM and in
                  the tab order — only visually hidden (sr-only clips it,
                  it never gets display:none/hidden) — nested inside the
                  Label so clicking the styled control opens the native OS
                  picker exactly as a bare <input type="file"> would.
                  focus-within on the Label (not a focus style on the
                  input itself) is what makes the *visible* control show a
                  focus ring when the hidden input has keyboard focus. */}
              <Label
                htmlFor="documentFile"
                className="border-input hover:bg-accent focus-within:ring-ring inline-flex h-9 w-fit cursor-pointer items-center rounded-md border bg-transparent px-3 text-sm font-medium shadow-xs focus-within:ring-2 focus-within:ring-offset-2"
              >
                Select file
                <input
                  id="documentFile"
                  type="file"
                  name="file"
                  required
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
              Maximum file size: {MAX_DOCUMENT_FILE_SIZE_LABEL}
            </p>
          </div>

          {clientFileError && (
            <p className="text-destructive text-sm">{clientFileError}</p>
          )}
          {state.fieldErrors?.file && (
            <p className="text-destructive text-sm">{state.fieldErrors.file[0]}</p>
          )}
          {state.fieldErrors?.documentType && (
            <p className="text-destructive text-sm">
              {state.fieldErrors.documentType[0]}
            </p>
          )}
          {state.formError && (
            <p role="alert" className="text-destructive text-sm">
              {state.formError}
            </p>
          )}
          {state.success && (
            <p className="text-sm text-green-700 dark:text-green-400">Uploaded</p>
          )}
          <Button type="submit" size="sm" disabled={isPending} className="w-fit">
            {isPending ? "Uploading..." : "Upload document"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
