import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { GenerateReceiptForm } from "@/components/admin/payments/generate-receipt-form";
import { formatTimestampAsIstDate } from "@/lib/domain/reports";
import { receiptDownloadHref, resolveReceiptState } from "@/lib/domain/receipts";
import type { ReceiptSummary } from "@/lib/data/receipts";

/**
 * Phase 21A — the payment's receipt on the Admin payment detail page
 * (FR-94). Receipts are issued automatically when a payment becomes paid;
 * this card shows the issued number and offers the download, and only
 * offers "Generate receipt" when that automatic step has not completed.
 * Nothing here can change an issued receipt.
 */
export function PaymentReceiptCard({
  paymentId,
  paymentStatus,
  receipt,
  loadError,
}: {
  paymentId: string;
  paymentStatus: string;
  receipt: ReceiptSummary | null;
  loadError?: string;
}) {
  const state = resolveReceiptState({ paymentStatus, receipt });

  let body: React.ReactNode;
  if (loadError) {
    body = (
      <p role="alert" className="text-destructive text-sm">
        {loadError}
      </p>
    );
  } else if (state === "not_eligible") {
    body = (
      <p className="text-muted-foreground text-sm">
        Receipts are issued only for paid payments.
      </p>
    );
  } else if (state === "not_issued") {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          No receipt has been issued for this payment yet.
        </p>
        <GenerateReceiptForm paymentId={paymentId} label="Generate receipt" />
      </div>
    );
  } else if (receipt) {
    body = (
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          <div>
            <dt className="text-muted-foreground text-xs">Receipt number</dt>
            <dd className="font-medium">{receipt.receiptNumber}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Issued on</dt>
            <dd className="font-medium">
              {formatTimestampAsIstDate(receipt.issuedAt) || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Document</dt>
            <dd className="font-medium">
              {state === "ready" ? "PDF ready" : "PDF not generated yet"}
            </dd>
          </div>
        </dl>
        {state === "ready" ? (
          <a
            href={receiptDownloadHref(paymentId)}
            download
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "w-fit",
            })}
          >
            Download receipt
          </a>
        ) : (
          <GenerateReceiptForm paymentId={paymentId} label="Retry PDF generation" />
        )}
        <p className="text-muted-foreground text-xs">
          A receipt number is permanent and is never reissued for another payment.
        </p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2 className="text-base">Receipt</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
