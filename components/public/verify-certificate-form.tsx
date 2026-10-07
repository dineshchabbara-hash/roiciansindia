"use client";

import { useActionState } from "react";
import {
  verifyCertificateAction,
  type VerifyCertificateState,
} from "@/lib/actions/certificates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const initialState: VerifyCertificateState = {};

/**
 * Public, unauthenticated certificate verification (FR-101). Displays only
 * the minimal field set lib/domain/certificates.ts's PublicCertificateVerification
 * carries — certificate number, student display name, program name, issue
 * date, status — never anything else, matching the certificates table's
 * own documented approved-field list.
 */
export function VerifyCertificateForm() {
  const [state, formAction, isPending] = useActionState(
    verifyCertificateAction,
    initialState,
  );

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="certificateNumber">Certificate number</Label>
          <Input
            id="certificateNumber"
            name="certificateNumber"
            type="text"
            placeholder="CERT-2026-000001"
            required
            autoComplete="off"
          />
        </div>

        {state.formError && (
          <p role="alert" className="text-destructive text-sm">
            {state.formError}
          </p>
        )}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "Checking..." : "Verify"}
        </Button>
      </form>

      {state.checked && state.result === null && (
        <p className="text-muted-foreground text-sm" role="status">
          No certificate was found with that number.
        </p>
      )}

      {state.checked && state.result && (
        <div className="flex flex-col gap-2 rounded-md border p-4 text-sm" role="status">
          <div className="flex items-center justify-between">
            <span className="font-medium">{state.result.certificateNumber}</span>
            <Badge variant={state.result.status === "issued" ? "success" : "destructive"}>
              {state.result.status === "issued" ? "Valid" : "Revoked"}
            </Badge>
          </div>
          <p>
            <span className="text-muted-foreground">Student:</span>{" "}
            {state.result.studentName}
          </p>
          <p>
            <span className="text-muted-foreground">Program:</span>{" "}
            {state.result.programName}
          </p>
          <p>
            <span className="text-muted-foreground">Issue date:</span>{" "}
            {state.result.issueDate}
          </p>
        </div>
      )}
    </div>
  );
}
