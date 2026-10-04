import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDecimalAsINR } from "@/lib/domain/money";
import type { MyPaymentPlanRow } from "@/lib/data/student-portal";
import type { InstallmentStatus } from "@/lib/domain/payment-plans";

const STATUS_LABELS: Record<InstallmentStatus, string> = {
  upcoming: "Upcoming",
  due: "Due",
  partially_paid: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  waived: "Waived",
};

/**
 * Read-only installment schedule for the Student's own Enrollment
 * (FR-43/FR-96). No mutation controls anywhere in this component — RLS
 * (payment_plans_select_own/installments_select_own) already restricts the
 * Student to select-only on these tables, and this module never relies on
 * RLS alone (lib/data/student-portal.ts's own getMyPaymentPlanForEnrollment
 * re-scopes by the caller's own enrollment first).
 */
export function StudentPaymentPlanCard({ plan }: { plan: MyPaymentPlanRow | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment Plan</CardTitle>
      </CardHeader>
      <CardContent>
        {!plan ? (
          <p className="text-muted-foreground text-sm">
            No payment plan has been set up for this enrollment yet.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-muted-foreground text-xs">Plan total</p>
              <p className="font-medium">{formatDecimalAsINR(plan.totalAmount)}</p>
            </div>
            <ul className="flex flex-col gap-2">
              {plan.installments.map((installment) => (
                <li
                  key={installment.id}
                  className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0 last:pb-0"
                >
                  <span className="min-w-0 truncate">
                    {installment.label ?? `Installment ${installment.sequence}`}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {formatDecimalAsINR(installment.amount)} · due {installment.dueDate} ·{" "}
                    {STATUS_LABELS[installment.status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
