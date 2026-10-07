"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CertificateFormState } from "@/lib/actions/certificates";

const initialState: CertificateFormState = {};

/**
 * Admin issue form — completionDate is the only field; enrollmentId,
 * student_id, program_id, and the eligibility re-check all happen
 * server-side (issueCertificateAction -> issueCertificateRecord), never
 * trusting anything the browser could tamper with. The parent section
 * only renders this form at all when checkCertificateEligibility already
 * reported eligible, but the server re-derives eligibility independently
 * regardless (defense in depth, same posture as every other mutation in
 * this codebase).
 */
export function CertificateIssueForm({
  action,
}: {
  action: (
    prevState: CertificateFormState,
    formData: FormData,
  ) => Promise<CertificateFormState>;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="completionDate" className="text-xs">
          Completion date
        </Label>
        <Input id="completionDate" name="completionDate" type="date" required />
      </div>

      {state.formError && (
        <p role="alert" className="text-destructive text-xs">
          {state.formError}
        </p>
      )}
      {state.success && (
        <p className="text-xs text-green-700 dark:text-green-400">Certificate issued</p>
      )}

      <Button type="submit" size="sm" disabled={isPending} className="w-fit">
        {isPending ? "Issuing..." : "Issue certificate"}
      </Button>
    </form>
  );
}
