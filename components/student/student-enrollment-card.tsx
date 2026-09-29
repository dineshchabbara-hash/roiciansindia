import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EnrollmentStatusBadge } from "@/components/admin/enrollments/enrollment-status-badge";
import { formatPaiseAsINR } from "@/lib/domain/money";
import type { MyEnrollmentRow } from "@/lib/data/student-portal";

/**
 * Student-facing enrollment summary — deliberately shows only what Phase 10
 * decided is appropriate (enrollment code, program, batch, status, dates,
 * payment status) and nothing from the Admin-only projection
 * (lib/data/enrollments.ts's EnrollmentProfile: discount reason, source,
 * notes, fee breakdown). See the Phase 10 report for this decision.
 */
export function StudentEnrollmentCard({ enrollment }: { enrollment: MyEnrollmentRow }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">{enrollment.programName}</CardTitle>
          <p className="text-muted-foreground text-xs">{enrollment.enrollmentCode}</p>
        </div>
        <EnrollmentStatusBadge status={enrollment.status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div>
            <p className="text-muted-foreground text-xs">Batch</p>
            <p>{enrollment.batchName ?? "Not yet batch-assigned"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Enrollment date</p>
            <p>{enrollment.enrollmentDate}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Total payable</p>
            <p>{formatPaiseAsINR(enrollment.totalPayablePaise)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Outstanding</p>
            <p>{formatPaiseAsINR(enrollment.outstandingPaise)}</p>
          </div>
        </div>
        <Link
          href={`/student/enrollments/${enrollment.id}`}
          className="text-primary text-sm hover:underline"
        >
          View details
        </Link>
      </CardContent>
    </Card>
  );
}
