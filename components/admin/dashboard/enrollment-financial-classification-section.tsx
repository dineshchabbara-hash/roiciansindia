import { PipelineValueCard } from "@/components/admin/dashboard/pipeline-value-card";
import { ConfirmedUnpaidFeesCard } from "@/components/admin/dashboard/confirmed-unpaid-fees-card";
import { CancellationSettlementReviewCard } from "@/components/admin/dashboard/cancellation-settlement-review-card";
import { getEnrollmentFinancialClassificationSummary } from "@/lib/data/dashboard";

// One fetch, three cards — Pipeline/Confirmed/Cancelled-or-Withdrawn are
// bucketed from the exact same Enrollment rows in a single query
// (lib/data/dashboard.ts's getEnrollmentFinancialClassificationSummary),
// so no Enrollment is ever counted in more than one bucket and no card can
// drift from another's status definitions.
export async function EnrollmentFinancialClassificationSection() {
  const result = await getEnrollmentFinancialClassificationSummary();

  if (!result.ok) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PipelineValueCard error={result.error} />
        <ConfirmedUnpaidFeesCard error={result.error} />
        <CancellationSettlementReviewCard error={result.error} />
      </div>
    );
  }

  const d = result.data;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <PipelineValueCard
        pipelineValuePaise={d.pipelineValuePaise}
        pipelineEnrollmentCount={d.pipelineEnrollmentCount}
      />
      <ConfirmedUnpaidFeesCard
        confirmedUnpaidFeesPaise={d.confirmedUnpaidFeesPaise}
        confirmedEnrollmentsWithBalance={d.confirmedEnrollmentsWithBalance}
      />
      <CancellationSettlementReviewCard
        cancelledOrWithdrawnCount={d.cancelledOrWithdrawnCount}
        cancelledOrWithdrawnOriginalFeePaise={d.cancelledOrWithdrawnOriginalFeePaise}
      />
    </div>
  );
}
