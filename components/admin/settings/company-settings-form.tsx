"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateCompanySettingsAction,
  type SettingsFormState,
} from "@/lib/actions/company-settings";
import {
  SOCIAL_LINK_KEYS,
  SOCIAL_LINK_LABELS,
  previewNumber,
  type CompanySettings,
} from "@/lib/domain/company-settings";

const initialState: SettingsFormState = {};

type FieldProps = {
  name: string;
  label: string;
  defaultValue: string;
  errors?: string[];
  hint?: string;
  type?: string;
  inputMode?: "text" | "email" | "tel" | "url";
};

function Field({
  name,
  label,
  defaultValue,
  errors,
  hint,
  type = "text",
  inputMode,
}: FieldProps) {
  const id = `settings-${name}`;
  const describedBy = [hint ? `${id}-hint` : null, errors?.length ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        defaultValue={defaultValue}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {errors?.length ? (
        <p id={`${id}-error`} className="text-destructive text-xs">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Phase 21C — Company Settings editor (Super Admin only; the page renders
 * the read-only view for Admin). Every value is re-validated by the server
 * action and the database. Country and tax are shown read-only on the page:
 * V1 calculates no tax (FR-141 / DECISIONS_NEEDED D2).
 */
export function CompanySettingsForm({
  settings,
  year,
}: {
  settings: CompanySettings;
  year: number;
}) {
  const [state, formAction, isPending] = useActionState(
    updateCompanySettingsAction,
    initialState,
  );
  const echoed = state.values;
  const value = (name: string, saved: string | null) => echoed?.[name] ?? saved ?? "";
  const errors = state.fieldErrors ?? {};

  return (
    <form
      key={state.attempt ?? settings.updatedAt}
      action={formAction}
      aria-label="Company settings"
      className="flex flex-col gap-6"
    >
      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Identity</legend>
        <Field
          name="companyName"
          label="Brand name"
          defaultValue={value("companyName", settings.companyName)}
          errors={errors.companyName}
          hint="Shown across the portals (e.g. Roicians Tech)."
        />
        <Field
          name="legalName"
          label="Legal name"
          defaultValue={value("legalName", settings.legalName)}
          errors={errors.legalName}
          hint="Printed on receipts and certificates (e.g. Roicians Tech Pvt. Ltd.)."
        />
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Contact</legend>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="settings-address">Address</Label>
          <textarea
            id="settings-address"
            name="address"
            rows={3}
            defaultValue={value("address", settings.address)}
            aria-invalid={errors.address?.length ? true : undefined}
            className="border-input bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
          {errors.address?.length ? (
            <p className="text-destructive text-xs">{errors.address[0]}</p>
          ) : null}
        </div>
        <Field
          name="phone"
          label="Phone"
          inputMode="tel"
          defaultValue={value("phone", settings.phone)}
          errors={errors.phone}
        />
        <Field
          name="email"
          label="Email"
          type="email"
          defaultValue={value("email", settings.email)}
          errors={errors.email}
        />
        <Field
          name="website"
          label="Website"
          inputMode="url"
          defaultValue={value("website", settings.website)}
          errors={errors.website}
          hint="Full https:// address."
        />
        <Field
          name="gstin"
          label="GSTIN"
          defaultValue={value("gstin", settings.gstin)}
          errors={errors.gstin}
          hint="15 characters. Printed on receipts when set; tax itself stays disabled."
        />
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Numbering</legend>
        <Field
          name="receiptNumberFormat"
          label="Receipt number format"
          defaultValue={value("receiptNumberFormat", settings.receiptNumberFormat)}
          errors={errors.receiptNumberFormat}
          hint={`Applies to new receipts only. Example: ${previewNumber(
            settings.receiptNumberFormat,
            year,
            245,
          )}. Tokens: {year}, {seq:N}.`}
        />
        <Field
          name="certificateNumberFormat"
          label="Certificate number format"
          defaultValue={value(
            "certificateNumberFormat",
            settings.certificateNumberFormat,
          )}
          errors={errors.certificateNumberFormat}
          hint={`Applies to new certificates only. Example: ${previewNumber(
            settings.certificateNumberFormat,
            year,
            12,
          )}.`}
        />
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Certificate signatory</legend>
        <Field
          name="certificateSignatoryName"
          label="Signatory name"
          defaultValue={value(
            "certificateSignatoryName",
            settings.certificateSignatoryName,
          )}
          errors={errors.certificateSignatoryName}
        />
        <Field
          name="certificateSignatoryTitle"
          label="Signatory title"
          defaultValue={value(
            "certificateSignatoryTitle",
            settings.certificateSignatoryTitle,
          )}
          errors={errors.certificateSignatoryTitle}
        />
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Social links</legend>
        {SOCIAL_LINK_KEYS.map((key) => (
          <Field
            key={key}
            name={`social_${key}`}
            label={SOCIAL_LINK_LABELS[key]}
            inputMode="url"
            defaultValue={value(`social_${key}`, settings.socialLinks[key] ?? null)}
            errors={errors[`social_${key}`]}
          />
        ))}
      </fieldset>

      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {state.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
