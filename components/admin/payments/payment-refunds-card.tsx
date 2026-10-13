import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPaiseExact } from "@/components/admin/payments/payment-amount";
import { RefundForm } from "@/components/admin/payments/refund-form";
import { SyncRefundButton } from "@/components/admin/payments/sync-refund-button";
import { formatTimestampAsIstDate } from "@/lib/domain/reports";
import {
  canRefund,
  refundChannelFor,
  refundStatusLabel,
  summarizePaymentRefunds,
} from "@/lib/domain/refunds";
import type { RefundRow } from "@/lib/data/refunds";

/**
 * Phase 21B — refunds of one payment on the Admin payment detail page.
 * One ledger for both channels: an offline payment is refunded manually
 * (money already returned, recorded as processed); a Razorpay payment is
 * refunded through Razorpay (in progress until Razorpay confirms). The
 * payment itself, its receipt and the enrollment's payable are never
 * changed by a refund.
 */
export function PaymentRefundsCard({
  payment,
  refunds,
  outstandingPaise,
  refundId,
  today,
  loadError,
}: {
  payment: {
    id: string;
    status: string;
    method: string;
    amountPaise: number;
    paidAt: string | null;
  };
  refunds: RefundRow[];
  outstandingPaise: number | null;
  refundId: string;
  today: string;
  loadError?: string;
}) {
  const summary = summarizePaymentRefunds(payment.amountPaise, refunds);
  const channel = refundChannelFor(payment.method);

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2 className="text-base">Refunds</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loadError ? (
          <p role="alert" className="text-destructive text-sm">
            {loadError}
          </p>
        ) : (
          <>
            <dl
              aria-label="Refund summary"
              className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4"
            >
              {(
                [
                  ["Payment amount", summary.paymentPaise],
                  ["Refunded", summary.refundedPaise],
                  ["In progress", summary.inProgressPaise],
                  ["Refundable", summary.refundablePaise],
                ] as const
              ).map(([term, paise]) => (
                <div key={term}>
                  <dt className="text-muted-foreground text-xs">{term}</dt>
                  <dd className="font-medium">{formatPaiseExact(paise)}</dd>
                </div>
              ))}
            </dl>

            {refunds.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No refunds for this payment.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" aria-label="Refund history">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left text-xs">
                      <th className="py-2 pr-4 font-medium">Date</th>
                      <th className="py-2 pr-4 font-medium">Amount</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">Reason</th>
                      <th className="py-2 pr-4 font-medium">Reference</th>
                      <th className="py-2 pr-4 font-medium">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refunds.map((refund) => (
                      <tr key={refund.id} className="border-b align-top last:border-0">
                        <td className="py-2 pr-4">
                          {refund.refundedOn ??
                            (formatTimestampAsIstDate(refund.createdAt) || "—")}
                        </td>
                        <td className="py-2 pr-4">
                          {formatPaiseExact(refund.amountPaise)}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge
                            variant={
                              refund.status === "processed"
                                ? "success"
                                : refund.status === "failed"
                                  ? "destructive"
                                  : "warning"
                            }
                          >
                            {refundStatusLabel(refund.status)}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 whitespace-pre-wrap">{refund.reason}</td>
                        <td className="py-2 pr-4">
                          {refund.reference ?? refund.providerRefundId ?? "—"}
                          {refund.status === "initiated" && channel === "razorpay" && (
                            <div className="mt-2">
                              <SyncRefundButton
                                refundId={refund.id}
                                paymentId={payment.id}
                              />
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-4">{refund.initiatedByName ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {payment.status !== "paid" ? (
              <p className="text-muted-foreground text-sm">
                Refunds are available only for paid payments.
              </p>
            ) : canRefund(payment.status, summary) ? (
              <RefundForm
                // A new refund that takes capacity (processed or in progress)
                // remounts a blank form, so its fields can never be resubmitted
                // by accident; a declined attempt keeps the form and its error.
                key={refunds.filter((r) => r.status !== "failed").length}
                channel={channel}
                paymentId={payment.id}
                refundId={refundId}
                refundablePaise={summary.refundablePaise}
                outstandingPaise={outstandingPaise}
                today={today}
                earliestRefundDate={
                  payment.paidAt ? formatTimestampAsIstDate(payment.paidAt) || null : null
                }
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                Nothing left to refund on this payment.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
