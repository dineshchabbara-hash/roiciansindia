"use client";

import { useActionState } from "react";
import { addStudentNoteAction, type StudentFormState } from "@/lib/actions/students";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StudentNoteRow } from "@/lib/data/students";
import { formatDisplayTimestamp } from "@/lib/domain/students";

const initialState: StudentFormState = {};

export function StudentNotesSection({
  studentId,
  notes,
}: {
  studentId: string;
  notes: StudentNoteRow[];
}) {
  const boundAction = addStudentNoteAction.bind(null, studentId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal Notes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-xs">
          Staff-only — never shown to the student.
        </p>

        {notes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No notes yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {notes.map((note) => (
              <li key={note.id} className="border-b pb-3 text-sm last:border-0">
                <p>{note.note}</p>
                <p className="text-muted-foreground text-xs">
                  {note.createdByName} · {formatDisplayTimestamp(note.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}

        <form action={formAction} className="flex flex-col gap-2" noValidate>
          <textarea
            name="note"
            required
            rows={2}
            maxLength={2000}
            placeholder="Add a note..."
            className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs"
          />
          {state.fieldErrors?.note && (
            <p className="text-destructive text-sm">{state.fieldErrors.note[0]}</p>
          )}
          {state.formError && (
            <p role="alert" className="text-destructive text-sm">
              {state.formError}
            </p>
          )}
          <Button type="submit" size="sm" disabled={isPending} className="w-fit">
            {isPending ? "Adding..." : "Add note"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
