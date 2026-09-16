import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatPaiseAsINR } from "@/lib/domain/money";

// Deliberately not a "receivable"/"loss"/"refund due"/"written-off debt"
// label — cancellation/withdrawal settlement is an explicit future Phase 14
// workflow. This card is informational only: it never writes off a
// balance, waives a fee, refunds a payment, or otherwise touches the
// underlying records.
export function CancellationSettlementReviewCard({
  cancelledOrWithdrawnCount,
  cancelledOrWithdrawnOriginalFeePaise,
  error,
}: {
  cancelledOrWithdrawnCount?: number;
  cancelledOrWithdrawnOriginalFeePaise?: number;
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cancellation / Withdrawal — Settlement Review</CardTitle>
        <CardDescription>
          Cancelled and withdrawn enrollments, shown for review only. The amount is the
          original recorded fee — not a receivable, loss, refund due, or written-off debt.
          Settlement requires an approved Phase 14 workflow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : (
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-bold">{cancelledOrWithdrawnCount ?? 0}</span>
            <span className="text-muted-foreground text-sm">
              enrollment{cancelledOrWithdrawnCount === 1 ? "" : "s"} — original recorded
              fee total {formatPaiseAsINR(cancelledOrWithdrawnOriginalFeePaise ?? 0)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
