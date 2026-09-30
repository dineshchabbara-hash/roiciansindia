"use client";

import { Fragment, useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRY_OPTIONS,
} from "@/lib/domain/phone-countries";
import { getPhoneCountry } from "@/lib/domain/students";
import type { StudentSelfProfileFormState } from "@/lib/actions/student-profile";
import type { MyStudentProfile } from "@/lib/data/student-portal";

const initialState: StudentSelfProfileFormState = {};

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-destructive text-sm">{errors[0]}</p>;
}

/**
 * Editable fields are exactly REQUIREMENTS.md FR-41's Student self-service
 * set (phone, address) — see lib/validation/student-self-profile.ts for why
 * this is a separate, narrower form from the Admin's StudentForm, not a
 * restricted view of it. Name/DOB/gender/email/status/etc. are rendered
 * read-only on the profile page itself, never as disabled inputs here.
 */
export function StudentProfileForm({
  action,
  profile,
}: {
  action: (
    prevState: StudentSelfProfileFormState,
    formData: FormData,
  ) => Promise<StudentSelfProfileFormState>;
  profile: MyStudentProfile;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  // Same React-19-resets-uncontrolled-fields fix as
  // components/admin/students/student-form.tsx.
  const [priorState, setPriorState] = useState(state);
  const [generation, setGeneration] = useState(0);
  if (state !== priorState) {
    setPriorState(state);
    setGeneration((g) => g + 1);
  }

  const value = (
    field: keyof NonNullable<StudentSelfProfileFormState["submittedValues"]>,
  ) => state.submittedValues?.[field] ?? undefined;

  const defaultPhoneCountry = getPhoneCountry(profile.phone) ?? DEFAULT_PHONE_COUNTRY;

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4" noValidate>
      <Fragment key={generation}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Phone</Label>
          <div className="flex gap-2">
            <select
              id="phoneCountry"
              name="phoneCountry"
              aria-label="Phone country"
              defaultValue={value("phoneCountry") ?? defaultPhoneCountry}
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
              defaultValue={value("phone") ?? profile.phone}
              aria-invalid={!!state.fieldErrors?.phone}
              className="flex-1"
            />
          </div>
          <FieldError errors={state.fieldErrors?.phoneCountry} />
          <FieldError errors={state.fieldErrors?.phone} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alternatePhone">Alternate phone (optional)</Label>
          <Input
            id="alternatePhone"
            name="alternatePhone"
            defaultValue={value("alternatePhone") ?? profile.alternatePhone ?? undefined}
            aria-invalid={!!state.fieldErrors?.alternatePhone}
          />
          <FieldError errors={state.fieldErrors?.alternatePhone} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addressLine1">Address line 1 (optional)</Label>
          <Input
            id="addressLine1"
            name="addressLine1"
            defaultValue={value("addressLine1") ?? profile.addressLine1 ?? undefined}
            aria-invalid={!!state.fieldErrors?.addressLine1}
          />
          <FieldError errors={state.fieldErrors?.addressLine1} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addressLine2">Address line 2 (optional)</Label>
          <Input
            id="addressLine2"
            name="addressLine2"
            defaultValue={value("addressLine2") ?? profile.addressLine2 ?? undefined}
            aria-invalid={!!state.fieldErrors?.addressLine2}
          />
          <FieldError errors={state.fieldErrors?.addressLine2} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="city">City (optional)</Label>
            <Input
              id="city"
              name="city"
              defaultValue={value("city") ?? profile.city ?? undefined}
              aria-invalid={!!state.fieldErrors?.city}
            />
            <FieldError errors={state.fieldErrors?.city} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="state">State (optional)</Label>
            <Input
              id="state"
              name="state"
              defaultValue={value("state") ?? profile.state ?? undefined}
              aria-invalid={!!state.fieldErrors?.state}
            />
            <FieldError errors={state.fieldErrors?.state} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="postalCode">Postal code (optional)</Label>
          <Input
            id="postalCode"
            name="postalCode"
            defaultValue={value("postalCode") ?? profile.postalCode ?? undefined}
            aria-invalid={!!state.fieldErrors?.postalCode}
          />
          <FieldError errors={state.fieldErrors?.postalCode} />
        </div>
      </Fragment>

      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          Saved
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}
