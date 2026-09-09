"use client";

import { useActionState } from "react";
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

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            name="firstName"
            required
            defaultValue={defaultValues?.firstName}
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
            defaultValue={defaultValues?.lastName}
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
          defaultValue={defaultValues?.preferredName ?? undefined}
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
              defaultValue={defaultValues?.phoneCountry ?? DEFAULT_PHONE_COUNTRY}
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
              defaultValue={defaultValues?.phone}
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
            defaultValue={defaultValues?.alternatePhone ?? undefined}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email (optional)</Label>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={defaultValues?.email ?? undefined}
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
            defaultValue={defaultValues?.dateOfBirth ?? undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gender">Gender (optional)</Label>
          <Input
            id="gender"
            name="gender"
            defaultValue={defaultValues?.gender ?? undefined}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="addressLine1">Address line 1 (optional)</Label>
        <Input
          id="addressLine1"
          name="addressLine1"
          defaultValue={defaultValues?.addressLine1 ?? undefined}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="addressLine2">Address line 2 (optional)</Label>
        <Input
          id="addressLine2"
          name="addressLine2"
          defaultValue={defaultValues?.addressLine2 ?? undefined}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="city">City (optional)</Label>
          <Input id="city" name="city" defaultValue={defaultValues?.city ?? undefined} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="state">State (optional)</Label>
          <Input
            id="state"
            name="state"
            defaultValue={defaultValues?.state ?? undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="postalCode">Postal code (optional)</Label>
          <Input
            id="postalCode"
            name="postalCode"
            defaultValue={defaultValues?.postalCode ?? undefined}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="emergencyContactName">Emergency contact name (optional)</Label>
          <Input
            id="emergencyContactName"
            name="emergencyContactName"
            defaultValue={defaultValues?.emergencyContactName ?? undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="emergencyContactPhone">
            Emergency contact phone (optional)
          </Label>
          <Input
            id="emergencyContactPhone"
            name="emergencyContactPhone"
            defaultValue={defaultValues?.emergencyContactPhone ?? undefined}
          />
        </div>
      </div>

      {state.duplicates && state.duplicates.length > 0 && (
        <DuplicateWarningPanel duplicates={state.duplicates} />
      )}

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
