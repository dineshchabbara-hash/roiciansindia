import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { formatPaiseExact } from "@/components/admin/payments/payment-amount";
import { formatTimestampAsIstDate } from "@/lib/domain/reports";
import { paymentMethodLabel } from "@/lib/domain/payments";
import { receiptDownloadHref } from "@/lib/domain/receipts";
import type { PaymentReceiptRow } from "@/lib/data/receipts";

/**
 * Phase 21A — the Student's own paid payments for this enrollment, each
 * with its receipt (FR-94). Rows come from the Student's RLS-scoped
 * session only. Every paid payment offers its download: the route streams
 * the stored PDF, or generates it on demand if the automatic step has not
 * finished yet (the same receipt number is always reused).
 */
export function StudentReceiptsCard({
  rows,
  loadError,
}: {
  rows: PaymentReceiptRow[];
  loadError?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments &amp; receipts</CardTitle>
      </CardHeader>
      <CardContent>
        {loadError ? (
          <p role="alert" className="text-destructive text-sm">
            {loadError}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No payments recorded yet.</p>
        ) : (
          <ul aria-label="Payments and receipts" className="flex flex-col gap-3">
            {rows.map((row) => (
              <li
                key={row.paymentId}
                className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm first:border-0 first:pt-0"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">
                    {formatPaiseExact(row.amountPaise)} · {paymentMethodLabel(row.method)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {row.paymentCode} · Paid {formatTimestampAsIstDate(row.paidAt) || "—"}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {row.receipt
                      ? `Receipt ${row.receipt.receiptNumber}`
                      : "Receipt being prepared"}
                  </span>
                </div>
                <a
                  href={receiptDownloadHref(row.paymentId)}
                  download
                  aria-label={`Download receipt for ${row.paymentCode}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Download receipt
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
