"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  removeCompanyLogoAction,
  uploadCompanyLogoAction,
  type SettingsFormState,
} from "@/lib/actions/company-settings";
import { ACCEPTED_IMAGE_INPUT } from "@/lib/domain/images";
import { MAX_LOGO_LABEL } from "@/lib/domain/company-settings";

const initialState: SettingsFormState = {};

/** Phase 21C — company logo upload/removal (Super Admin only). */
export function CompanyLogoForm({ logoUrl }: { logoUrl: string | null }) {
  const [uploadState, uploadAction, uploading] = useActionState(
    uploadCompanyLogoAction,
    initialState,
  );
  const [removeState, removeAction, removing] = useActionState(
    removeCompanyLogoAction,
    initialState,
  );
  const error = uploadState.formError ?? removeState.formError;
  const message = uploadState.message ?? removeState.message;

  return (
    <div className="flex flex-col gap-4">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- public branding asset
        <img
          src={logoUrl}
          alt="Current company logo"
          className="h-16 w-auto self-start rounded border bg-white p-1"
        />
      ) : (
        <p className="text-muted-foreground text-sm">No logo uploaded.</p>
      )}
      <form
        action={uploadAction}
        aria-label="Upload logo"
        className="flex flex-col gap-2"
      >
        <Label htmlFor="company-logo">Logo image</Label>
        <input
          id="company-logo"
          name="logo"
          type="file"
          accept={ACCEPTED_IMAGE_INPUT}
          required
          className="text-sm"
          aria-describedby="company-logo-hint"
        />
        <p id="company-logo-hint" className="text-muted-foreground text-xs">
          PNG, JPEG or WebP, up to {MAX_LOGO_LABEL}. Stored as public branding.
        </p>
        <div>
          <Button type="submit" size="sm" disabled={uploading}>
            {uploading ? "Uploading..." : "Upload logo"}
          </Button>
        </div>
      </form>
      {logoUrl && (
        <form action={removeAction} aria-label="Remove logo">
          <Button type="submit" size="sm" variant="outline" disabled={removing}>
            {removing ? "Removing..." : "Remove logo"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {message && !error && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {message}
        </p>
      )}
    </div>
  );
}
