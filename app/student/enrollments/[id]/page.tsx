import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EnrollmentStatusBadge } from "@/components/admin/enrollments/enrollment-status-badge";
import { formatPaiseAsINR } from "@/lib/domain/money";
import { getMyEnrollment } from "@/lib/data/student-portal";

export const dynamic = "force-dynamic";

// Direct-URL/ID-manipulation defense point (IMPLEMENTATION_PLAN.md Phase 10
// DoD): getMyEnrollment (lib/data/student-portal.ts) scopes its query by
// BOTH this id AND the caller's own resolved student id. Another student's
// enrollment id therefore comes back identically to a genuinely nonexistent
// one — notFound() either way — never a distinct "not yours" response that
// would confirm the id exists.
export default async function StudentEnrollmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getMyEnrollment(id);

  if (!result.ok) {
    if (result.error === "Enrollment not found.") {
      notFound();
    }
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }

  const enrollment = result.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{enrollment.programName}</h1>
        <EnrollmentStatusBadge status={enrollment.status} />
      </div>
      <p className="text-muted-foreground text-sm">{enrollment.enrollmentCode}</p>

      <Card>
        <CardHeader>
          <CardTitle>Program details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">Program</p>
            <p>
              {enrollment.programName} ({enrollment.programCode})
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Batch</p>
            <p>{enrollment.batchName ?? "Not yet batch-assigned"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Enrollment date</p>
            <p>{enrollment.enrollmentDate}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment status</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">Total payable</p>
            <p className="font-medium">
              {formatPaiseAsINR(enrollment.totalPayablePaise)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Outstanding</p>
            <p className="font-medium">{formatPaiseAsINR(enrollment.outstandingPaise)}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
