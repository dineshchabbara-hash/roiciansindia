import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPaiseAsINR } from "@/lib/domain/money";
import type { RecentPayment } from "@/lib/data/dashboard";

function statusVariant(
  status: string,
): "default" | "secondary" | "warning" | "destructive" {
  switch (status) {
    case "paid":
      return "default";
    case "pending":
    case "authorized":
      return "warning";
    case "failed":
    case "cancelled":
      return "destructive";
    default:
      return "secondary";
  }
}

export function RecentPaymentsCard({
  data,
  error,
}: {
  data?: RecentPayment[];
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Payments</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : !data || data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No recent payments</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.map((payment) => (
              <li
                key={payment.id}
                className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{payment.studentName}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {payment.programName}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-medium">
                    {formatPaiseAsINR(payment.totalAmountPaise)}
                  </span>
                  <Badge variant={statusVariant(payment.status)}>{payment.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
