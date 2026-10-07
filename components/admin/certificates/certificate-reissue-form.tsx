"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CertificateFormState } from "@/lib/actions/certificates";

const initialState: CertificateFormState = {};

/**
 * Reissue (replace) — creates a new certificate with a new number/PDF and
 * marks this one revoked, atomically (reissueCertificateRecord ->
 * reissue_certificate() DB function). Collapsed by default, same
 * disclosure discipline as CertificateRevokeForm.
 */
export function CertificateReissueForm({
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
        Reissue
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Input name="reason" placeholder="Reason (optional)" />
      {state.formError && (
        <p role="alert" className="text-destructive text-xs">
          {state.formError}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Reissuing..." : "Confirm reissue"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
