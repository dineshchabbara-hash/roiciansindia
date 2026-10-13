"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { syncRazorpayRefundAction, type RefundFormState } from "@/lib/actions/refunds";

const initialState: RefundFormState = {};

/**
 * "Check status with Razorpay" for one in-progress Razorpay refund: asks
 * Razorpay for the payment's refunds and applies the matching one
 * (idempotent). Only ids are submitted.
 */
export function SyncRefundButton({
  refundId,
  paymentId,
}: {
  refundId: string;
  paymentId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    syncRazorpayRefundAction,
    initialState,
  );
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="refundId" value={refundId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending ? "Checking..." : "Check status with Razorpay"}
      </Button>
      {state.formError && (
        <span role="alert" className="text-destructive text-xs">
          {state.formError}
        </span>
      )}
      {state.message && (
        <span role="status" className="text-muted-foreground text-xs">
          {state.message}
        </span>
      )}
    </form>
  );
}
