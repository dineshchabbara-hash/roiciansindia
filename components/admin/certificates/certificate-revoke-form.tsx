"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CertificateFormState } from "@/lib/actions/certificates";

const initialState: CertificateFormState = {};

/**
 * Standalone revoke — no replacement. Collapsed behind a disclosure by
 * default so the destructive action isn't one accidental click away on a
 * row that's otherwise just being viewed/downloaded.
 */
export function CertificateRevokeForm({
  action,
}: {
  action: (
    prevState: CertificateFormState,
    formData: FormData,
  ) => Promise<CertificateFormState>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(action, initialState);

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Revoke
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Input name="revokedReason" placeholder="Reason (optional)" />
      {state.formError && (
        <p role="alert" className="text-destructive text-xs">
          {state.formError}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={isPending}>
          {isPending ? "Revoking..." : "Confirm revoke"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
