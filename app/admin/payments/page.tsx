import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/admin/pagination";
import { PaymentLedgerFiltersForm } from "@/components/admin/payments/payment-ledger-filters";
import { PaymentLedgerTable } from "@/components/admin/payments/payment-ledger-table";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";
import { getPaymentLedgerPage } from "@/lib/data/payments";
import {
  parsePaymentLedgerFilters,
  paymentLedgerFiltersToParams,
  type PaymentLedgerSearchParams,
} from "@/lib/domain/payments";

export const dynamic = "force-dynamic";

/**
 * Phase 20A Admin Payments ledger: an operational list of recorded
 * payments (offline today; online payments will appear here once Phase
 * 20B exists). Not a report — balances and totals stay in the Phase 14
 * enrollment view and the Phase 19 Financial report.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<PaymentLedgerSearchParams>;
}) {
  // Defense in depth on top of the /admin layout gate.
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const filters = parsePaymentLedgerFilters(await searchParams);
  const result = await getPaymentLedgerPage(filters);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Payments</h1>
          <p className="text-muted-foreground text-sm">
            Every recorded payment, newest payment date first. Recorded payments are
            permanent and cannot be edited.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/payments/new">Record offline payment</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2 className="text-base">Filters</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PaymentLedgerFiltersForm filters={filters} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          {!result.ok ? (
            <p role="alert" className="text-destructive text-sm">
              {result.error}
            </p>
          ) : (
            <>
              <p className="text-muted-foreground text-sm" aria-live="polite">
                {result.data.total === 1 ? "1 payment" : `${result.data.total} payments`}
              </p>
              <PaymentLedgerTable rows={result.data.rows} />
              <Pagination
                page={result.data.page}
                pageSize={result.data.pageSize}
                total={result.data.total}
                basePath="/admin/payments"
                searchParams={paymentLedgerFiltersToParams(filters)}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
