import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDecimalAsINR } from "@/lib/domain/money";
import type { PaymentPlanRow } from "@/lib/data/payment-plans";
import { CreatePaymentPlanForm } from "@/components/admin/payment-plans/create-payment-plan-form";
import { InstallmentRow } from "@/components/admin/payment-plans/installment-row";
import { AddInstallmentRowForm } from "@/components/admin/payment-plans/add-installment-row-form";

/**
 * Admin-facing Payment Plan section for one Enrollment
 * (app/admin/enrollments/[id]/page.tsx). No plan yet -> the create form
 * (IMPLEMENTATION_PLAN.md Phase 14 DoD worked example). A plan already
 * exists -> its installments, each independently editable/waivable/
 * removable, plus a form to append a new line. total_amount is always the
 * server-computed sum of the installments below it — never a field shown
 * as "the real total" separately, so there is nothing here that could
 * visually drift from its own rows.
 */
export function PaymentPlanCard({
  enrollmentId,
  plan,
}: {
  enrollmentId: string;
  plan: PaymentPlanRow | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment Plan</CardTitle>
      </CardHeader>
      <CardContent>
        {!plan ? (
          <CreatePaymentPlanForm enrollmentId={enrollmentId} />
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-muted-foreground text-xs">Plan total</p>
              <p className="font-medium">{formatDecimalAsINR(plan.totalAmount)}</p>
            </div>
            <ul className="flex flex-col gap-3">
              {plan.installments.map((installment) => (
                <InstallmentRow
                  key={installment.id}
                  installment={installment}
                  enrollmentId={enrollmentId}
                />
              ))}
            </ul>
            <AddInstallmentRowForm planId={plan.id} enrollmentId={enrollmentId} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
