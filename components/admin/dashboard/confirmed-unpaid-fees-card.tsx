import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatPaiseAsINR } from "@/lib/domain/money";

export function ConfirmedUnpaidFeesCard({
  confirmedUnpaidFeesPaise,
  confirmedEnrollmentsWithBalance,
  error,
}: {
  confirmedUnpaidFeesPaise?: number;
  confirmedEnrollmentsWithBalance?: number;
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirmed Unpaid Fees</CardTitle>
        <CardDescription>
          Unpaid balances for confirmed enrollments, based on recorded fees, payments and
          processed refunds. Excludes leads, applicants and records awaiting
          cancellation/withdrawal settlement.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : (
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-bold">
              {formatPaiseAsINR(confirmedUnpaidFeesPaise ?? 0)}
            </span>
            <span className="text-muted-foreground text-sm">
              across {confirmedEnrollmentsWithBalance ?? 0} enrollment
              {confirmedEnrollmentsWithBalance === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
