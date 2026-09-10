"use client";

import { Fragment, useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { TrainerDuplicateWarningPanel } from "@/components/admin/trainers/duplicate-warning-panel";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRY_OPTIONS,
} from "@/lib/domain/phone-countries";
import type { TrainerFormState } from "@/lib/actions/trainers";
import type { TrainerProfile } from "@/lib/data/trainers";
import { formatSpecializationForDisplay } from "@/lib/domain/trainers";

const initialState: TrainerFormState = {};

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-destructive text-sm">{errors[0]}</p>;
}

type TrainerFormDefaults = Partial<Omit<TrainerProfile, "specialization">> & {
  specialization?: string[];
  phoneCountry?: string;
};

export function TrainerForm({
  action,
  defaultValues,
  submitLabel,
}: {
  action: (prevState: TrainerFormState, formData: FormData) => Promise<TrainerFormState>;
  defaultValues?: TrainerFormDefaults;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  // Same React-19-resets-uncontrolled-form-fields fix as
  // components/admin/students/student-form.tsx — see that file's comment
  // for the full explanation of why this is needed and why the key lives
  // at this one outer Fragment rather than scattered per-field.
  const [priorState, setPriorState] = useState(state);
  const [generation, setGeneration] = useState(0);
  if (state !== priorState) {
    setPriorState(state);
    setGeneration((g) => g + 1);
  }

  const value = (field: keyof NonNullable<TrainerFormState["submittedValues"]>) =>
    state.submittedValues?.[field] ?? undefined;

  const defaultSpecialization = defaultValues?.specialization
    ? formatSpecializationForDisplay(defaultValues.specialization)
    : undefined;

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4" noValidate>
      <Fragment key={generation}>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              name="firstName"
              required
              defaultValue={value("firstName") ?? defaultValues?.firstName}
              aria-invalid={!!state.fieldErrors?.firstName}
            />
            <FieldError errors={state.fieldErrors?.firstName} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              name="lastName"
              required
              defaultValue={value("lastName") ?? defaultValues?.lastName}
              aria-invalid={!!state.fieldErrors?.lastName}
            />
            <FieldError errors={state.fieldErrors?.lastName} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={value("email") ?? defaultValues?.email}
            aria-invalid={!!state.fieldErrors?.email}
          />
          <FieldError errors={state.fieldErrors?.email} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Phone (optional)</Label>
          <div className="flex gap-2">
            <select
              id="phoneCountry"
              name="phoneCountry"
              aria-label="Phone country"
              defaultValue={
                value("phoneCountry") ??
                defaultValues?.phoneCountry ??
                DEFAULT_PHONE_COUNTRY
              }
              aria-invalid={!!state.fieldErrors?.phoneCountry}
              className="border-input h-9 w-[9.5rem] shrink-0 rounded-md border bg-transparent px-2 text-sm shadow-xs"
            >
              {PHONE_COUNTRY_OPTIONS.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name} (+{country.callingCode})
                </option>
              ))}
            </select>
            <Input
              id="phone"
              name="phone"
              defaultValue={value("phone") ?? defaultValues?.phone ?? undefined}
              aria-invalid={!!state.fieldErrors?.phone}
              className="flex-1"
            />
          </div>
          {/* Only reachable via a request that didn't come from this
              <select> — see student-form.tsx's identical comment. */}
          <FieldError errors={state.fieldErrors?.phoneCountry} />
          <FieldError errors={state.fieldErrors?.phone} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="specialization">Specialization (optional)</Label>
          <Input
            id="specialization"
            name="specialization"
            placeholder="e.g. React, Node.js, Testing"
            defaultValue={value("specialization") ?? defaultSpecialization}
          />
          <p className="text-muted-foreground text-xs">Comma-separated skills.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bio">Bio (optional)</Label>
          <textarea
            id="bio"
            name="bio"
            rows={3}
            className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs"
            defaultValue={value("bio") ?? defaultValues?.bio ?? undefined}
          />
        </div>

        {state.duplicates && state.duplicates.length > 0 && (
          <TrainerDuplicateWarningPanel
            duplicates={state.duplicates}
            defaultChecked={state.submittedOverride?.confirmOverride}
            defaultReason={state.submittedOverride?.overrideReason}
          />
        )}
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
