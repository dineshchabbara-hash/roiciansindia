"use client";

import { Fragment, useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DuplicateWarningPanel } from "@/components/admin/students/duplicate-warning-panel";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRY_OPTIONS,
} from "@/lib/domain/phone-countries";
import type { StudentFormState } from "@/lib/actions/students";
import type { StudentProfile } from "@/lib/data/students";

const initialState: StudentFormState = {};

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-destructive text-sm">{errors[0]}</p>;
}

export function StudentForm({
  action,
  defaultValues,
  submitLabel,
}: {
  action: (prevState: StudentFormState, formData: FormData) => Promise<StudentFormState>;
  defaultValues?: Partial<StudentProfile> & { phoneCountry?: string };
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  // React resets a <form action={...}> hooked up via useActionState to its
  // fields' original defaultValue once the action resolves (documented
  // React 19 behavior) — without correcting for it, the whole form would
  // go blank the instant a duplicate warning (or any other non-redirecting
  // response) appears, discarding everything the admin just typed. state's
  // own submittedValues (set by the action to exactly what was submitted)
  // is what should reappear instead; bumping `generation` remounts every
  // field below with a fresh defaultValue, since changing the defaultValue
  // prop on an already-mounted uncontrolled input does not by itself make
  // React reapply it. This is React's own documented pattern for deriving
  // state from a changing prop during render, not a useEffect.
  const [priorState, setPriorState] = useState(state);
  const [generation, setGeneration] = useState(0);
  if (state !== priorState) {
    setPriorState(state);
    setGeneration((g) => g + 1);
  }

  const value = (field: keyof NonNullable<StudentFormState["submittedValues"]>) =>
    state.submittedValues?.[field] ?? defaultValues?.[field] ?? undefined;

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4" noValidate>
      {/* Keyed on `generation` so the whole field set remounts (picking up
          fresh defaultValues from `value()`/submittedOverride above)
          whenever the action returns a new state — see the comment above.
          One key at this single outer point, rather than scattered across
          every field, avoids two true JSX siblings (like the phoneCountry
          <select> and phone <Input> below) ever sharing an identical key. */}
      <Fragment key={generation}>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              name="firstName"
              required
              defaultValue={value("firstName")}
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
              defaultValue={value("lastName")}
              aria-invalid={!!state.fieldErrors?.lastName}
            />
            <FieldError errors={state.fieldErrors?.lastName} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="preferredName">Preferred name (optional)</Label>
          <Input
            id="preferredName"
            name="preferredName"
            defaultValue={value("preferredName")}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Phone</Label>
            <div className="flex gap-2">
              <select
                id="phoneCountry"
                name="phoneCountry"
                aria-label="Phone country"
                defaultValue={value("phoneCountry") ?? DEFAULT_PHONE_COUNTRY}
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
                required
                defaultValue={value("phone")}
                aria-invalid={!!state.fieldErrors?.phone}
                className="flex-1"
              />
            </div>
            {/* Only reachable via a request that didn't come from this <select>
              (e.g. a tampered/direct API call) — the option list above only
              ever offers values the server accepts, but the server still
              never trusts that assumption, so this stays rendered for when
              it doesn't hold. */}
            <FieldError errors={state.fieldErrors?.phoneCountry} />
            <FieldError errors={state.fieldErrors?.phone} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="alternatePhone">Alternate phone (optional)</Label>
            <Input
              id="alternatePhone"
              name="alternatePhone"
              defaultValue={value("alternatePhone")}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email (optional)</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={value("email")}
            aria-invalid={!!state.fieldErrors?.email}
          />
          <FieldError errors={state.fieldErrors?.email} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dateOfBirth">Date of birth (optional)</Label>
            <Input
              id="dateOfBirth"
              name="dateOfBirth"
              type="date"
              defaultValue={value("dateOfBirth")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gender">Gender (optional)</Label>
            <Input id="gender" name="gender" defaultValue={value("gender")} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addressLine1">Address line 1 (optional)</Label>
          <Input
            id="addressLine1"
            name="addressLine1"
            defaultValue={value("addressLine1")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addressLine2">Address line 2 (optional)</Label>
          <Input
            id="addressLine2"
            name="addressLine2"
            defaultValue={value("addressLine2")}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="city">City (optional)</Label>
            <Input id="city" name="city" defaultValue={value("city")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="state">State (optional)</Label>
            <Input id="state" name="state" defaultValue={value("state")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="postalCode">Postal code (optional)</Label>
            <Input id="postalCode" name="postalCode" defaultValue={value("postalCode")} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emergencyContactName">
              Emergency contact name (optional)
            </Label>
            <Input
              id="emergencyContactName"
              name="emergencyContactName"
              defaultValue={value("emergencyContactName")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emergencyContactPhone">
              Emergency contact phone (optional)
            </Label>
            <Input
              id="emergencyContactPhone"
              name="emergencyContactPhone"
              defaultValue={value("emergencyContactPhone")}
            />
          </div>
        </div>

        {state.duplicates && state.duplicates.length > 0 && (
          <DuplicateWarningPanel
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
