import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPaiseAsINR } from "@/lib/domain/money";
import type { EnrollmentFinancialSummary } from "@/lib/data/enrollments";

/**
 * Read-only financial position for one Enrollment (Phase 9 scope: display
 * only — no payment creation/editing, no refund processing here). Every
 * figure is scoped to exactly this Enrollment's own payments/refunds;
 * see lib/data/enrollments.ts's getEnrollmentFinancialSummary for the
 * isolation guarantee.
 */
export function EnrollmentFinancialSummaryCard({
  summary,
}: {
  summary: EnrollmentFinancialSummary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Financial Position</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Total payable</p>
          <p className="font-medium">{formatPaiseAsINR(summary.totalPayablePaise)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Total paid</p>
          <p className="font-medium">{formatPaiseAsINR(summary.totalPaidPaise)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Total refunded</p>
          <p className="font-medium">{formatPaiseAsINR(summary.totalRefundedPaise)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Outstanding</p>
          <p className="font-medium">{formatPaiseAsINR(summary.outstandingPaise)}</p>
        </div>
      </CardContent>
    </Card>
  );
}
