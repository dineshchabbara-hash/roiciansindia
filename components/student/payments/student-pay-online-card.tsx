import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PayOnlineButtons } from "@/components/student/payments/pay-online-buttons";
import { formatPaiseExact } from "@/components/admin/payments/payment-amount";
import { getMyOnlinePaymentQuote } from "@/lib/data/online-payments";
import { getRazorpayKeys } from "@/lib/payments/razorpay-config";
import { getCompanyBranding } from "@/lib/data/company-settings";

/**
 * Student "Pay online" card (FR-43). Every amount shown is computed on the
 * server (Phase 14 outstanding + oldest-first installment coverage); the
 * buttons carry only which option was chosen. Nothing is offered for an
 * unconfirmed enrollment or when nothing is outstanding. Whether Razorpay
 * is configured is reduced to a yes/no — no key or secret reaches this
 * component.
 */
export async function StudentPayOnlineCard({ enrollmentId }: { enrollmentId: string }) {
  const quote = await getMyOnlinePaymentQuote(enrollmentId);

  let body: React.ReactNode;
  if (!quote.ok) {
    body = (
      <p role="alert" className="text-destructive text-sm">
        {quote.error}
      </p>
    );
  } else if (!quote.data.eligible) {
    body = (
      <p className="text-muted-foreground text-sm">
        Online payment becomes available once your enrollment is confirmed.
      </p>
    );
  } else if (quote.data.options.length === 0) {
    body = (
      <p className="text-muted-foreground text-sm">Nothing is outstanding. Thank you!</p>
    );
  } else if (!getRazorpayKeys().ok) {
    body = (
      <p className="text-muted-foreground text-sm">
        Online payment is not available right now. Please contact the institute to pay.
      </p>
    );
  } else {
    const branding = await getCompanyBranding();
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Outstanding balance: {formatPaiseExact(quote.data.outstandingPaise)}. You will
          pay securely on Razorpay; your balance updates as soon as the payment is
          confirmed.
        </p>
        <PayOnlineButtons
          enrollmentId={quote.data.enrollmentId}
          merchantName={branding.companyName}
          options={quote.data.options.map((option) => ({
            purpose: option.purpose,
            label: option.label,
            amountLabel: formatPaiseExact(option.amountPaise),
          }))}
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pay online</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
