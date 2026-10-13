"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  initiateRazorpayRefundAction,
  recordOfflineRefundAction,
  type RefundFormState,
} from "@/lib/actions/refunds";
import { rupeeStringToPaise } from "@/lib/domain/payments";
import { outstandingAfterRefund, type RefundChannel } from "@/lib/domain/refunds";
import { formatPaiseExact } from "@/components/admin/payments/payment-amount";

const initialState: RefundFormState = {};

/**
 * Admin refund entry (Phase 21B). Carries only what the Admin decides —
 * amount, reason, and for an offline refund the refund date and an
 * optional reference — plus two server-rendered ids: the payment, and a
 * refund id minted on the server for this render, which makes a
 * double-submit idempotent. The refundable ceiling shown is advisory; the
 * database re-checks it under a payment row lock.
 *
 * The outstanding preview states the financial consequence plainly: a
 * refund returns money; it does not reduce the student's fee or payable,
 * so outstanding rises by the refunded amount (D8 option A). A Razorpay
 * refund changes the balance only once Razorpay confirms it.
 */
export function RefundForm({
  channel,
  paymentId,
  refundId,
  refundablePaise,
  outstandingPaise,
  today,
  earliestRefundDate,
}: {
  channel: RefundChannel;
  paymentId: string;
  refundId: string;
  refundablePaise: number;
  outstandingPaise: number | null;
  today: string;
  earliestRefundDate: string | null;
}) {
  const [state, formAction, isPending] = useActionState(
    channel === "offline" ? recordOfflineRefundAction : initiateRazorpayRefundAction,
    initialState,
  );
  const [amount, setAmount] = useState("");
  const amountPaise = rupeeStringToPaise(amount) ?? 0;

  return (
    <form action={formAction} aria-label="Refund payment" className="flex flex-col gap-4">
      <input type="hidden" name="refundId" value={refundId} />
      <input type="hidden" name="paymentId" value={paymentId} />

      <p className="text-muted-foreground text-sm">
        A refund records money returned to the student. It does not reduce the
        student&apos;s fee or total payable — the outstanding balance goes up by the
        refunded amount
        {channel === "razorpay" ? " once Razorpay confirms the refund." : "."}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="refund-amount">Refund amount (₹)</Label>
          <Input
            id="refund-amount"
            name="amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-describedby="refund-amount-hint"
          />
          <p id="refund-amount-hint" className="text-muted-foreground text-xs">
            Refundable now: {formatPaiseExact(refundablePaise)}
          </p>
        </div>

        {channel === "offline" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="refund-date">Refund date</Label>
            <Input
              id="refund-date"
              name="refundedOn"
              type="date"
              required
              defaultValue={today}
              max={today}
              min={earliestRefundDate ?? undefined}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="refund-reason">Reason</Label>
          <textarea
            id="refund-reason"
            name="reason"
            required
            maxLength={500}
            rows={2}
            className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs"
          />
        </div>

        {channel === "offline" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="refund-reference">Reference (optional)</Label>
            <Input id="refund-reference" name="reference" maxLength={100} />
          </div>
        )}
      </div>

      {outstandingPaise !== null && (
        <dl aria-label="Outstanding balance" className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground text-xs">Outstanding now</dt>
            <dd className="font-medium">{formatPaiseExact(outstandingPaise)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              {channel === "razorpay"
                ? "Outstanding once Razorpay confirms this refund"
                : "Outstanding after this refund"}
            </dt>
            <dd className="font-medium">
              {formatPaiseExact(outstandingAfterRefund(outstandingPaise, amountPaise))}
            </dd>
          </div>
        </dl>
      )}

      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-green-700 dark:text-green-300">
          {state.message}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending
          ? "Refunding..."
          : channel === "offline"
            ? "Record refund"
            : "Refund via Razorpay"}
      </Button>
    </form>
  );
}
