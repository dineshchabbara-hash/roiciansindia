"use client";

import { useActionState } from "react";
import {
  deleteStudentDocumentAction,
  uploadStudentDocumentAction,
  type DeleteDocumentState,
  type StudentFormState,
} from "@/lib/actions/students";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StudentDocumentRow } from "@/lib/data/students";

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
                    {new Date(doc.createdAt).toLocaleString()}
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

        <form action={formAction} className="flex flex-col gap-2" noValidate>
          <Input
            name="documentType"
            placeholder="Document type (e.g. ID proof)"
            required
          />
          <input type="file" name="file" required className="text-sm" />
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
