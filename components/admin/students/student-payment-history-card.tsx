import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPaiseAsINR, toPaise } from "@/lib/domain/money";
import type { StudentPaymentHistoryRow } from "@/lib/data/students";

export function StudentPaymentHistoryCard({
  data,
  error,
}: {
  data?: StudentPaymentHistoryRow[];
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment History</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : !data || data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No payments yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.map((payment) => (
              <li
                key={payment.id}
                className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium">
                    {formatPaiseAsINR(toPaise(payment.totalAmount))}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {payment.enrollmentCode} · {payment.method}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={payment.status === "paid" ? "success" : "secondary"}>
                    {payment.status}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {payment.paidAt ?? payment.createdAt}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
