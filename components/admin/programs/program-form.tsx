"use client";

import { Fragment, useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DELIVERY_MODES, DURATION_UNITS } from "@/lib/domain/programs";
import type { ProgramFormState } from "@/lib/actions/programs";
import type { ProgramProfile } from "@/lib/data/programs";

const initialState: ProgramFormState = {};

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-destructive text-sm">{errors[0]}</p>;
}

type ProgramFormDefaults = Omit<ProgramProfile, "id" | "status" | "createdAt">;

export function ProgramForm({
  action,
  defaultValues,
  submitLabel,
}: {
  action: (prevState: ProgramFormState, formData: FormData) => Promise<ProgramFormState>;
  defaultValues?: ProgramFormDefaults;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  // Same React-19-resets-uncontrolled-form-fields fix as
  // components/admin/trainers/trainer-form.tsx — see that file's comment
  // for the full explanation.
  const [priorState, setPriorState] = useState(state);
  const [generation, setGeneration] = useState(0);
  if (state !== priorState) {
    setPriorState(state);
    setGeneration((g) => g + 1);
  }

  const isEditing = defaultValues !== undefined;

  const value = (field: keyof NonNullable<ProgramFormState["submittedValues"]>) =>
    state.submittedValues?.[field] ?? undefined;

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4" noValidate>
      <Fragment key={generation}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="programCode">Program code</Label>
          {isEditing ? (
            // Immutable after creation (see lib/data/programs.ts's
            // updateProgramProfile comment) — rendered read-only rather than
            // omitted entirely, since a readOnly input (unlike disabled)
            // still submits its value, keeping one shared schema/action for
            // create and edit without ever letting an edit change the code.
            <Input
              id="programCode"
              name="programCode"
              readOnly
              value={defaultValues.programCode}
              aria-readonly="true"
              className="bg-muted cursor-not-allowed"
            />
          ) : (
            <Input
              id="programCode"
              name="programCode"
              required
              defaultValue={value("programCode")}
              aria-invalid={!!state.fieldErrors?.programCode}
            />
          )}
          <FieldError errors={state.fieldErrors?.programCode} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Program name</Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={value("name") ?? defaultValues?.name}
            aria-invalid={!!state.fieldErrors?.name}
          />
          <FieldError errors={state.fieldErrors?.name} />
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
          <Label htmlFor="category">Category (optional)</Label>
          <Input
            id="category"
            name="category"
            defaultValue={value("category") ?? defaultValues?.category ?? undefined}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="durationValue">Duration (optional)</Label>
            <Input
              id="durationValue"
              name="durationValue"
              inputMode="numeric"
              defaultValue={
                value("durationValue") ?? defaultValues?.durationValue ?? undefined
              }
              aria-invalid={!!state.fieldErrors?.durationValue}
            />
            <FieldError errors={state.fieldErrors?.durationValue} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="durationUnit">Duration unit</Label>
            <select
              id="durationUnit"
              name="durationUnit"
              defaultValue={value("durationUnit") ?? defaultValues?.durationUnit ?? ""}
              aria-invalid={!!state.fieldErrors?.durationUnit}
              className="border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs"
            >
              <option value="">—</option>
              {DURATION_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
            <FieldError errors={state.fieldErrors?.durationUnit} />
          </div>
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

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="regularFee">Regular fee (INR)</Label>
            <Input
              id="regularFee"
              name="regularFee"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              required
              defaultValue={value("regularFee") ?? defaultValues?.regularFee}
              aria-invalid={!!state.fieldErrors?.regularFee}
            />
            <FieldError errors={state.fieldErrors?.regularFee} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="registrationFee">Registration fee (INR)</Label>
            <Input
              id="registrationFee"
              name="registrationFee"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={
                value("registrationFee") ?? defaultValues?.registrationFee ?? "0"
              }
              aria-invalid={!!state.fieldErrors?.registrationFee}
            />
            <FieldError errors={state.fieldErrors?.registrationFee} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="taxRatePercent">Tax rate % (optional)</Label>
          <Input
            id="taxRatePercent"
            name="taxRatePercent"
            type="number"
            step="0.01"
            min="0"
            max="100"
            inputMode="decimal"
            defaultValue={
              value("taxRatePercent") ?? defaultValues?.taxRatePercent ?? undefined
            }
            aria-invalid={!!state.fieldErrors?.taxRatePercent}
          />
          <p className="text-muted-foreground text-xs">
            Leave blank to use the company&apos;s default tax rate.
          </p>
          <FieldError errors={state.fieldErrors?.taxRatePercent} />
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="certificateEligible"
              defaultChecked={
                state.submittedValues
                  ? state.submittedValues.certificateEligible === "on"
                  : (defaultValues?.certificateEligible ?? true)
              }
            />
            Certificate eligible
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="installmentsAllowed"
              defaultChecked={
                state.submittedValues
                  ? state.submittedValues.installmentsAllowed === "on"
                  : (defaultValues?.installmentsAllowed ?? true)
              }
            />
            Installments allowed
          </label>
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
