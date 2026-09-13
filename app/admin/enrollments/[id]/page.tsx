import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EnrollmentStatusBadge } from "@/components/admin/enrollments/enrollment-status-badge";
import { EnrollmentStatusControl } from "@/components/admin/enrollments/enrollment-status-control";
import { EnrollmentFinancialSummaryCard } from "@/components/admin/enrollments/enrollment-financial-summary-card";
import { formatDecimalAsINR } from "@/lib/domain/money";
import {
  getEnrollmentFinancialSummary,
  getEnrollmentProfile,
} from "@/lib/data/enrollments";

export const dynamic = "force-dynamic";

function SectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}

async function FinancialSection({
  enrollmentId,
  totalPayable,
}: {
  enrollmentId: string;
  totalPayable: string;
}) {
  const result = await getEnrollmentFinancialSummary(enrollmentId, totalPayable);
  if (!result.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Financial Position</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-destructive text-sm">
            {result.error}
          </p>
        </CardContent>
      </Card>
    );
  }
  return <EnrollmentFinancialSummaryCard summary={result.data} />;
}

export default async function EnrollmentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profileResult = await getEnrollmentProfile(id);

  if (!profileResult.ok) {
    notFound();
  }

  const enrollment = profileResult.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{enrollment.enrollmentCode}</h1>
            <EnrollmentStatusBadge status={enrollment.status} />
          </div>
          <p className="text-muted-foreground text-sm">
            <Link
              href={`/admin/students/${enrollment.studentId}`}
              className="hover:underline"
            >
              {enrollment.studentName} ({enrollment.studentCode})
            </Link>
            {" · "}
            <Link
              href={`/admin/programs/${enrollment.programId}`}
              className="hover:underline"
            >
              {enrollment.programName} ({enrollment.programCode})
            </Link>
            {enrollment.batchId && (
              <>
                {" · "}
                <Link
                  href={`/admin/batches/${enrollment.batchId}`}
                  className="hover:underline"
                >
                  {enrollment.batchName}
                </Link>
              </>
            )}
          </p>
        </div>
        <EnrollmentStatusControl
          enrollmentId={enrollment.id}
          currentStatus={enrollment.status}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Commercial Terms</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">Enrollment date</p>
            <p>{enrollment.enrollmentDate}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Regular fee</p>
            <p>{formatDecimalAsINR(enrollment.regularFee)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Agreed fee</p>
            <p>{formatDecimalAsINR(enrollment.agreedFee)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Discount amount</p>
            <p>{formatDecimalAsINR(enrollment.discountAmount)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Discount reason</p>
            <p>{enrollment.discountReason ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Registration fee</p>
            <p>{formatDecimalAsINR(enrollment.registrationFee)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Tax amount</p>
            <p>{formatDecimalAsINR(enrollment.taxAmount)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Total payable</p>
            <p className="font-medium">{formatDecimalAsINR(enrollment.totalPayable)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Payment plan</p>
            <p>{enrollment.paymentPlanType ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Source</p>
            <p>{enrollment.source ?? "—"}</p>
          </div>
          <div className="col-span-2 md:col-span-3">
            <p className="text-muted-foreground text-xs">Notes</p>
            <p className="whitespace-pre-wrap">{enrollment.notes ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <Suspense fallback={<SectionSkeleton />}>
        <FinancialSection
          enrollmentId={enrollment.id}
          totalPayable={enrollment.totalPayable}
        />
      </Suspense>
    </div>
  );
}
