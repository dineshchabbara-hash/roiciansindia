"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { generateReceiptAction, type GenerateReceiptState } from "@/lib/actions/receipts";

const initialState: GenerateReceiptState = {};

/**
 * Admin recovery for a paid payment whose automatic receipt step did not
 * complete. Only the payment id is submitted; the server re-checks the
 * role, and the database re-checks that the payment is paid and reuses
 * any receipt (and number) that already exists.
 */
export function GenerateReceiptForm({
  paymentId,
  label,
}: {
  paymentId: string;
  label: string;
}) {
  const [state, formAction, isPending] = useActionState(
    generateReceiptAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="paymentId" value={paymentId} />
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending ? "Generating..." : label}
      </Button>
      {state.error && (
        <p role="alert" className="text-destructive text-xs">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-xs text-green-700 dark:text-green-300">
          {state.message}
        </p>
      )}
    </form>
  );
}
