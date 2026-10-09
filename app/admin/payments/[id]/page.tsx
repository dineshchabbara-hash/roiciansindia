import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentStatusBadge } from "@/components/admin/payments/payment-ledger-table";
import { formatPaiseExact } from "@/components/admin/payments/payment-amount";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";
import { getPaymentDetail } from "@/lib/data/payments";
import { formatTimestampAsIstDate } from "@/lib/domain/reports";
import { paymentMethodLabel, paymentTypeLabel } from "@/lib/domain/payments";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One payment, read-only. There is no edit or delete action: a recorded
 * payment is an immutable transaction row (FR-91), enforced in the
 * database for every role.
 */
export default async function PaymentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ recorded?: string }>;
}) {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const result = await getPaymentDetail(id);
  if (!result.ok) notFound();
  const payment = result.data;
  const justRecorded = (await searchParams).recorded === "1";

  const facts: Array<[string, React.ReactNode]> = [
    ["Payment date", formatTimestampAsIstDate(payment.paidAt) || "—"],
    ["Amount", formatPaiseExact(payment.amountPaise)],
    ["Tax", formatPaiseExact(payment.taxAmountPaise)],
    ["Method", paymentMethodLabel(payment.method)],
    ["Type", paymentTypeLabel(payment.paymentType)],
    ["Reference", payment.reference ?? "—"],
    [
      "Student",
      <Link
        key="s"
        href={`/admin/students/${payment.studentId}`}
        className="hover:underline"
      >
        {payment.studentName} ({payment.studentCode})
      </Link>,
    ],
    [
      "Enrollment",
      <Link
        key="e"
        href={`/admin/enrollments/${payment.enrollmentId}`}
        className="hover:underline"
      >
        {payment.enrollmentCode}
      </Link>,
    ],
    ["Program", payment.programName],
    ["Batch", payment.batchName ?? "—"],
    [
      "Recorded by",
      payment.recordedByAdmin ? (payment.recordedByName ?? "An administrator") : "Online",
    ],
    ["Recorded on", formatTimestampAsIstDate(payment.createdAt) || "—"],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/admin/payments"
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Payments
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{payment.paymentCode}</h1>
          <PaymentStatusBadge status={payment.status} />
        </div>
      </div>

      {justRecorded && (
        <p
          role="status"
          className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
        >
          Payment {payment.paymentCode} recorded against {payment.enrollmentCode}.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2 className="text-base">Payment details</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl
            aria-label="Payment details"
            className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4"
          >
            {facts.map(([term, value]) => (
              <div key={term}>
                <dt className="text-muted-foreground text-xs">{term}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {payment.notes && (
            <div className="text-sm">
              <p className="text-muted-foreground text-xs">Notes</p>
              <p className="whitespace-pre-wrap">{payment.notes}</p>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            This payment is a permanent transaction record and cannot be edited or
            deleted.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
