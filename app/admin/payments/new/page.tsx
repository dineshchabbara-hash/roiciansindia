import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EnrollmentPaymentContext } from "@/components/admin/payments/enrollment-payment-context";
import { RecordPaymentForm } from "@/components/admin/payments/record-payment-form";
import { formatPaiseExact } from "@/components/admin/payments/payment-amount";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";
import { findEnrollmentIdByCode } from "@/lib/data/payments";
import {
  getEnrollmentFinancialSummary,
  getEnrollmentProfile,
} from "@/lib/data/enrollments";
import { canReceiveOfflinePayment, istToday } from "@/lib/domain/payments";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ enrollment?: string | string[] }>;

/**
 * Record an offline payment (FR-90 / BR-6). Step 1 finds the enrollment by
 * its exact code (a GET form — the code lives in the URL, so the
 * Enrollment page can deep-link here). Step 2 shows who and what is being
 * paid, with the Phase 14 figures, and only then the entry form.
 */
export default async function RecordPaymentPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const raw = (await searchParams).enrollment;
  const code = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/admin/payments"
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Payments
        </Link>
        <h1 className="text-2xl font-semibold">Record offline payment</h1>
        <p className="text-muted-foreground text-sm">
          Cash, UPI, bank transfer or cheque received against one enrollment.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2 className="text-base">Find the enrollment</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            method="GET"
            action="/admin/payments/new"
            aria-label="Find enrollment"
            className="flex flex-wrap items-end gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="enrollment-code">Enrollment code</Label>
              <Input
                id="enrollment-code"
                name="enrollment"
                defaultValue={code}
                placeholder="ENR-000123"
                autoComplete="off"
                className="w-56"
                required
              />
            </div>
            <Button type="submit" variant="outline">
              Find enrollment
            </Button>
          </form>
        </CardContent>
      </Card>

      {code && <EnrollmentStep code={code} />}
    </div>
  );
}

async function EnrollmentStep({ code }: { code: string }) {
  const lookup = await findEnrollmentIdByCode(code);
  if (!lookup.ok) return <Notice>{lookup.error}</Notice>;
  if (!lookup.data) return <Notice>No enrollment has the code “{code}”.</Notice>;

  const profileResult = await getEnrollmentProfile(lookup.data);
  if (!profileResult.ok) return <Notice>{profileResult.error}</Notice>;
  const enrollment = profileResult.data;

  const summaryResult = await getEnrollmentFinancialSummary(
    enrollment.id,
    enrollment.totalPayable,
  );
  if (!summaryResult.ok) return <Notice>{summaryResult.error}</Notice>;
  const summary = summaryResult.data;

  let body: React.ReactNode;
  if (!canReceiveOfflinePayment(enrollment.status)) {
    body = (
      <p role="alert" className="text-sm">
        Payments can only be recorded against a confirmed enrollment (enrolled, active, on
        hold or completed). This enrollment is {enrollment.status.replace("_", " ")}.
      </p>
    );
  } else if (summary.outstandingPaise <= 0) {
    body = (
      <p role="alert" className="text-sm">
        This enrollment has no outstanding balance, so there is nothing to record.
      </p>
    );
  } else {
    body = (
      <RecordPaymentForm
        paymentId={randomUUID()}
        enrollmentId={enrollment.id}
        today={istToday()}
        outstandingLabel={formatPaiseExact(summary.outstandingPaise)}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2 className="text-base">
            Payment for{" "}
            <Link
              href={`/admin/enrollments/${enrollment.id}`}
              className="hover:underline"
            >
              {enrollment.enrollmentCode}
            </Link>
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <EnrollmentPaymentContext enrollment={enrollment} summary={summary} />
        {body}
      </CardContent>
    </Card>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent>
        <p role="alert" className="text-destructive text-sm">
          {children}
        </p>
      </CardContent>
    </Card>
  );
}
