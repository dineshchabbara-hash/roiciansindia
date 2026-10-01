"use client";

import { Fragment, useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { ClassSessionFormState } from "@/lib/actions/class-sessions";
import type { ClassSessionRow } from "@/lib/data/class-sessions";

const initialState: ClassSessionFormState = {};

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-destructive text-sm">{errors[0]}</p>;
}

type ClassSessionFormDefaults = Pick<
  ClassSessionRow,
  | "sessionDate"
  | "startTime"
  | "endTime"
  | "topic"
  | "description"
  | "meetingLink"
  | "notes"
>;

// batchId and status are deliberately not fields in this form — batchId is
// always bound server-side from the route's own already-authorized params
// (never a value the browser submits, see lib/validation/class-sessions.ts),
// and status changes go through the separate ClassSessionStatusControl on
// the detail page, the same split components/admin/batches/batch-form.tsx
// and batch-status-control.tsx already established for Batches.
export function ClassSessionForm({
  action,
  defaultValues,
  submitLabel,
}: {
  action: (
    prevState: ClassSessionFormState,
    formData: FormData,
  ) => Promise<ClassSessionFormState>;
  defaultValues?: ClassSessionFormDefaults;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  // Same React-19-resets-uncontrolled-form-fields fix as
  // components/admin/batches/batch-form.tsx — see that file's comment for
  // the full explanation.
  const [priorState, setPriorState] = useState(state);
  const [generation, setGeneration] = useState(0);
  if (state !== priorState) {
    setPriorState(state);
    setGeneration((g) => g + 1);
  }

  const value = (field: keyof NonNullable<ClassSessionFormState["submittedValues"]>) =>
    state.submittedValues?.[field] ?? undefined;

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4" noValidate>
      <Fragment key={generation}>
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sessionDate">Session date</Label>
            <Input
              id="sessionDate"
              name="sessionDate"
              type="date"
              required
              defaultValue={value("sessionDate") ?? defaultValues?.sessionDate}
              aria-invalid={!!state.fieldErrors?.sessionDate}
            />
            <FieldError errors={state.fieldErrors?.sessionDate} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="startTime">Start time (optional)</Label>
            <Input
              id="startTime"
              name="startTime"
              type="time"
              defaultValue={
                value("startTime") ?? defaultValues?.startTime?.slice(0, 5) ?? undefined
              }
              aria-invalid={!!state.fieldErrors?.startTime}
            />
            <FieldError errors={state.fieldErrors?.startTime} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="endTime">End time (optional)</Label>
            <Input
              id="endTime"
              name="endTime"
              type="time"
              defaultValue={
                value("endTime") ?? defaultValues?.endTime?.slice(0, 5) ?? undefined
              }
              aria-invalid={!!state.fieldErrors?.endTime}
            />
            <FieldError errors={state.fieldErrors?.endTime} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="topic">Topic (optional)</Label>
          <Input
            id="topic"
            name="topic"
            defaultValue={value("topic") ?? defaultValues?.topic ?? undefined}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">Description (optional)</Label>
          <textarea
            id="description"
            name="description"
            rows={3}
            className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs"
            defaultValue={value("description") ?? defaultValues?.description ?? undefined}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="meetingLink">Meeting link (optional)</Label>
          <Input
            id="meetingLink"
            name="meetingLink"
            defaultValue={value("meetingLink") ?? defaultValues?.meetingLink ?? undefined}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notes (optional)</Label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs"
            defaultValue={value("notes") ?? defaultValues?.notes ?? undefined}
          />
        </div>
      </Fragment>

      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
