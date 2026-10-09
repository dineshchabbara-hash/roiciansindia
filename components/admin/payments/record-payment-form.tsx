"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  recordOfflinePaymentAction,
  type RecordPaymentFormState,
} from "@/lib/actions/payments";
import {
  OFFLINE_PAYMENT_METHODS,
  OFFLINE_PAYMENT_TYPES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TYPE_LABELS,
} from "@/lib/domain/payments";

const initialState: RecordPaymentFormState = {};

const SELECT_CLASS =
  "border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs";

/**
 * Offline payment entry. Carries only what the Admin decides (amount,
 * method, type, date received, reference, notes) plus two server-rendered
 * ids: the enrollment the page resolved, and a payment id minted on the
 * server for this render, which makes a double-submit idempotent (the
 * database returns the already-recorded payment instead of a second one).
 *
 * Student, recording admin, status, tax and payment code are never fields:
 * the database derives them. The amount ceiling shown here is advisory —
 * record_offline_payment() re-checks it under a row lock. Success
 * redirects to the payment's own page, so there is no transient success
 * message here; only an error keeps the form mounted.
 */
export function RecordPaymentForm({
  paymentId,
  enrollmentId,
  today,
  outstandingLabel,
}: {
  paymentId: string;
  enrollmentId: string;
  today: string;
  outstandingLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(
    recordOfflinePaymentAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      aria-label="Record offline payment"
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="enrollmentId" value={enrollmentId} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-amount">Amount received (₹)</Label>
          <Input
            id="payment-amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 2500.00"
            aria-describedby="payment-amount-hint"
            required
          />
          <p id="payment-amount-hint" className="text-muted-foreground text-xs">
            At most the outstanding balance ({outstandingLabel}). Partial payments are
            allowed.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-paid-on">Date received</Label>
          <Input
            id="payment-paid-on"
            name="paidOn"
            type="date"
            defaultValue={today}
            max={today}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-method">Payment method</Label>
          <select
            id="payment-method"
            name="method"
            defaultValue=""
            required
            className={SELECT_CLASS}
          >
            <option value="" disabled>
              Choose a method
            </option>
            {OFFLINE_PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-type">Payment type</Label>
          <select
            id="payment-type"
            name="paymentType"
            defaultValue="partial"
            required
            className={SELECT_CLASS}
          >
            {OFFLINE_PAYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {PAYMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-reference">Reference (optional)</Label>
          <Input
            id="payment-reference"
            name="reference"
            maxLength={100}
            autoComplete="off"
            placeholder="Cheque no., UTR, receipt book no."
          />
        </div>

        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="payment-notes">Notes (optional)</Label>
          <textarea
            id="payment-notes"
            name="notes"
            rows={3}
            maxLength={1000}
            className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs"
          />
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        A recorded payment cannot be edited or deleted. Check the student and enrollment
        above before saving.
      </p>

      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Recording..." : "Record payment"}
      </Button>
    </form>
  );
}
