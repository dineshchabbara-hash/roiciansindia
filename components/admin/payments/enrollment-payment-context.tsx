import { EnrollmentStatusBadge } from "@/components/admin/enrollments/enrollment-status-badge";
import type {
  EnrollmentFinancialSummary,
  EnrollmentProfile,
} from "@/lib/data/enrollments";
import { formatPaiseExact } from "@/components/admin/payments/payment-amount";

/**
 * Who and what the payment is being recorded against, shown before the
 * form so a payment is never attached to the wrong learner or enrollment.
 * Every money figure is getEnrollmentFinancialSummary's output (the Phase
 * 14 engine) — this component only formats it, to the paisa.
 */
export function EnrollmentPaymentContext({
  enrollment,
  summary,
}: {
  enrollment: EnrollmentProfile;
  summary: EnrollmentFinancialSummary;
}) {
  const facts: Array<[string, React.ReactNode]> = [
    ["Student", enrollment.studentName],
    ["Student ID", enrollment.studentCode],
    ["Program", `${enrollment.programName} (${enrollment.programCode})`],
    ["Batch", enrollment.batchName ?? "—"],
    ["Enrollment", enrollment.enrollmentCode],
    [
      "Enrollment status",
      <EnrollmentStatusBadge key="status" status={enrollment.status} />,
    ],
    ["Total payable", formatPaiseExact(summary.totalPayablePaise)],
    ["Already paid", formatPaiseExact(summary.totalPaidPaise)],
    ["Refunded", formatPaiseExact(summary.totalRefundedPaise)],
    ["Outstanding", formatPaiseExact(summary.outstandingPaise)],
  ];

  return (
    <dl
      aria-label="Enrollment being paid"
      className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-5"
    >
      {facts.map(([term, value]) => (
        <div key={term}>
          <dt className="text-muted-foreground text-xs">{term}</dt>
          <dd className="font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
