"use client";

import { Fragment, useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DELIVERY_MODES } from "@/lib/domain/batches";
import type { BatchFormState } from "@/lib/actions/batches";
import type { BatchProfile } from "@/lib/data/batches";

const initialState: BatchFormState = {};

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-destructive text-sm">{errors[0]}</p>;
}

type BatchFormDefaults = Omit<BatchProfile, "id" | "status" | "createdAt">;

export function BatchForm({
  action,
  defaultValues,
  programOptions,
  submitLabel,
}: {
  action: (prevState: BatchFormState, formData: FormData) => Promise<BatchFormState>;
  defaultValues?: BatchFormDefaults;
  programOptions: Array<{ id: string; name: string; programCode: string }>;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  // Same React-19-resets-uncontrolled-form-fields fix as
  // components/admin/programs/program-form.tsx — see that file's comment
  // for the full explanation.
  const [priorState, setPriorState] = useState(state);
  const [generation, setGeneration] = useState(0);
  if (state !== priorState) {
    setPriorState(state);
    setGeneration((g) => g + 1);
  }

  const isEditing = defaultValues !== undefined;

  const value = (field: keyof NonNullable<BatchFormState["submittedValues"]>) =>
    state.submittedValues?.[field] ?? undefined;

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4" noValidate>
      <Fragment key={generation}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="programId">Program</Label>
          {isEditing ? (
            // Program reassignment is not exposed in Phase 8 — see
            // lib/data/batches.ts's updateBatchProfile comment for why. A
            // hidden input carries the value forward for the shared
            // schema/action without ever letting an edit change it.
            <>
              <Input
                id="programId"
                readOnly
                aria-readonly="true"
                value={`${defaultValues.programName} (${defaultValues.programCode})`}
                className="bg-muted cursor-not-allowed"
              />
              <input type="hidden" name="programId" value={defaultValues.programId} />
            </>
          ) : (
            <select
              id="programId"
              name="programId"
              defaultValue={value("programId") ?? ""}
              aria-invalid={!!state.fieldErrors?.programId}
              className="border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs"
            >
              <option value="">Select a program</option>
              {programOptions.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.name} ({program.programCode})
                </option>
              ))}
            </select>
          )}
          <FieldError errors={state.fieldErrors?.programId} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Batch name</Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={value("name") ?? defaultValues?.name}
            aria-invalid={!!state.fieldErrors?.name}
          />
          <FieldError errors={state.fieldErrors?.name} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="startDate">Start date</Label>
            <Input
              id="startDate"
              name="startDate"
              type="date"
              required
              defaultValue={value("startDate") ?? defaultValues?.startDate}
              aria-invalid={!!state.fieldErrors?.startDate}
            />
            <FieldError errors={state.fieldErrors?.startDate} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expectedEndDate">Expected end date (optional)</Label>
            <Input
              id="expectedEndDate"
              name="expectedEndDate"
              type="date"
              defaultValue={
                value("expectedEndDate") ?? defaultValues?.expectedEndDate ?? undefined
              }
              aria-invalid={!!state.fieldErrors?.expectedEndDate}
            />
            <FieldError errors={state.fieldErrors?.expectedEndDate} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="daysOfWeek">Days of week (optional)</Label>
            <Input
              id="daysOfWeek"
              name="daysOfWeek"
              placeholder="e.g. sat, sun"
              defaultValue={
                value("daysOfWeek") ?? defaultValues?.daysOfWeek.join(", ") ?? undefined
              }
            />
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

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              name="timezone"
              defaultValue={
                value("timezone") ?? defaultValues?.timezone ?? "Asia/Kolkata"
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deliveryMode">Delivery mode (optional)</Label>
            <select
              id="deliveryMode"
              name="deliveryMode"
              defaultValue={value("deliveryMode") ?? defaultValues?.deliveryMode ?? ""}
              aria-invalid={!!state.fieldErrors?.deliveryMode}
              className="border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs"
            >
              <option value="">—</option>
              {DELIVERY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode.replace("_", " ")}
                </option>
              ))}
            </select>
            <FieldError errors={state.fieldErrors?.deliveryMode} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="capacity">Capacity (optional)</Label>
          <Input
            id="capacity"
            name="capacity"
            type="number"
            step="1"
            min="1"
            defaultValue={value("capacity") ?? defaultValues?.capacity ?? undefined}
            aria-invalid={!!state.fieldErrors?.capacity}
          />
          <FieldError errors={state.fieldErrors?.capacity} />
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
          <Label htmlFor="location">Location (optional)</Label>
          <Input
            id="location"
            name="location"
            defaultValue={value("location") ?? defaultValues?.location ?? undefined}
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
