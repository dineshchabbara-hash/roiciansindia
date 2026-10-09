import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatTimestampAsIstDate } from "@/lib/domain/reports";
import {
  paymentMethodLabel,
  paymentStatusLabel,
  paymentTypeLabel,
} from "@/lib/domain/payments";
import type { PaymentLedgerRow } from "@/lib/data/payments";
import { formatPaiseExact } from "@/components/admin/payments/payment-amount";

export function PaymentStatusBadge({ status }: { status: string }) {
  const variant =
    status === "paid"
      ? "success"
      : status === "pending" || status === "authorized"
        ? "warning"
        : status === "failed" || status === "cancelled"
          ? "destructive"
          : "secondary";
  return <Badge variant={variant}>{paymentStatusLabel(status)}</Badge>;
}

/**
 * Read-only ledger table. There is deliberately no edit or delete control
 * anywhere: a recorded payment is an immutable transaction row (FR-91),
 * enforced by the database, not by hiding a button.
 */
export function PaymentLedgerTable({ rows }: { rows: PaymentLedgerRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No payments match these filters.</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Payments">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-2 pr-3 font-medium">
              Payment
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Payment date
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Student
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Enrollment
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Program / Batch
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Amount
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Method
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Type
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Reference
            </th>
            <th scope="col" className="py-2 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b last:border-0">
              <td className="py-2 pr-3 font-medium">
                <Link href={`/admin/payments/${row.id}`} className="hover:underline">
                  {row.paymentCode}
                </Link>
              </td>
              <td className="py-2 pr-3">{formatTimestampAsIstDate(row.paidAt) || "—"}</td>
              <td className="py-2 pr-3">
                <Link
                  href={`/admin/students/${row.studentId}`}
                  className="hover:underline"
                >
                  {row.studentName}
                </Link>
                <span className="text-muted-foreground block text-xs">
                  {row.studentCode}
                </span>
              </td>
              <td className="py-2 pr-3">
                <Link
                  href={`/admin/enrollments/${row.enrollmentId}`}
                  className="hover:underline"
                >
                  {row.enrollmentCode}
                </Link>
              </td>
              <td className="py-2 pr-3">
                {row.programName}
                {row.batchName && (
                  <span className="text-muted-foreground block text-xs">
                    {row.batchName}
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {formatPaiseExact(row.amountPaise)}
              </td>
              <td className="py-2 pr-3">{paymentMethodLabel(row.method)}</td>
              <td className="py-2 pr-3">{paymentTypeLabel(row.paymentType)}</td>
              <td className="py-2 pr-3">{row.reference ?? "—"}</td>
              <td className="py-2">
                <PaymentStatusBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
