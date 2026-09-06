import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatPaiseAsINR } from "@/lib/domain/money";
import type { OutstandingFeesSummary } from "@/lib/data/dashboard";

export function OutstandingFeesCard({
  data,
  error,
}: {
  data?: OutstandingFeesSummary;
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Outstanding Fees</CardTitle>
        <CardDescription>
          Total payable minus paid payments plus processed refunds, across every
          enrollment.
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
              {formatPaiseAsINR(data?.totalOutstandingPaise ?? 0)}
            </span>
            <span className="text-muted-foreground text-sm">
              across {data?.enrollmentsWithBalance ?? 0} enrollment
              {data?.enrollmentsWithBalance === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
