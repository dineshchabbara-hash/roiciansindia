import { formatDecimalAsINR } from "@/lib/domain/money";
import {
  FINANCIAL_GROUP_LABELS,
  paiseToDecimalString,
  type FinancialGroup,
  type FinancialReportTotals,
} from "@/lib/domain/reports";

/**
 * Totals across EVERY row matching the current filters (not only the
 * visible page), each the sum of the engine's own per-enrollment figures.
 */
export function FinancialTotals({
  totals,
  group,
}: {
  totals: FinancialReportTotals;
  group: FinancialGroup;
}) {
  const items: Array<[string, string]> = [
    ["Enrollments", String(totals.enrollmentCount)],
    ["Total payable", formatDecimalAsINR(paiseToDecimalString(totals.totalPayablePaise))],
    ["Total paid", formatDecimalAsINR(paiseToDecimalString(totals.totalPaidPaise))],
    [
      "Total refunded",
      formatDecimalAsINR(paiseToDecimalString(totals.totalRefundedPaise)),
    ],
    ["Outstanding", formatDecimalAsINR(paiseToDecimalString(totals.outstandingPaise))],
  ];

  return (
    <section aria-labelledby="financial-totals-heading" className="flex flex-col gap-2">
      <h2 id="financial-totals-heading" className="text-base font-semibold">
        Totals for {FINANCIAL_GROUP_LABELS[group]}
      </h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {group !== "confirmed" && (
        <p className="text-muted-foreground text-xs">
          Outstanding is computed per enrollment by the same engine as the enrollment
          page. For Lead/Applicant or Cancelled/Withdrawn enrollments it is not a
          receivable.
        </p>
      )}
    </section>
  );
}
