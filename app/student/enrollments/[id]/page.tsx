import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EnrollmentStatusBadge } from "@/components/admin/enrollments/enrollment-status-badge";
import { formatPaiseAsINR } from "@/lib/domain/money";
import {
  getMyEnrollment,
  getMyAttendanceForEnrollment,
  getMyPaymentPlanForEnrollment,
  getMyMaterialsForEnrollment,
  getMyAssignmentsForEnrollment,
} from "@/lib/data/student-portal";
import { getCertificatesForEnrollment } from "@/lib/data/certificates";
import { StudentPaymentPlanCard } from "@/components/student/student-payment-plan-card";
import { StudentMaterialsCard } from "@/components/student/student-materials-card";
import { StudentAssignmentsCard } from "@/components/student/assignments/student-assignments-card";
import { StudentCertificatesCard } from "@/components/student/certificates/student-certificates-card";

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
  const attendanceResult = await getMyAttendanceForEnrollment(id);
  const paymentPlanResult = await getMyPaymentPlanForEnrollment(id);
  const materialsResult = await getMyMaterialsForEnrollment(id);
  const assignmentsResult = await getMyAssignmentsForEnrollment(id);
  const certificatesResult = await getCertificatesForEnrollment(id);

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

      <Card>
        <CardHeader>
          <CardTitle>Attendance</CardTitle>
        </CardHeader>
        <CardContent>
          {!attendanceResult.ok ? (
            <p role="alert" className="text-destructive text-sm">
              {attendanceResult.error}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-baseline gap-3">
                <span className="text-2xl font-bold">
                  {attendanceResult.data.summary?.attendancePercentage !== null &&
                  attendanceResult.data.summary?.attendancePercentage !== undefined
                    ? `${attendanceResult.data.summary.attendancePercentage}%`
                    : "—"}
                </span>
                <span className="text-muted-foreground text-sm">
                  {attendanceResult.data.summary
                    ? `${attendanceResult.data.summary.totalSessions} session${attendanceResult.data.summary.totalSessions === 1 ? "" : "s"} recorded`
                    : "No sessions recorded yet"}
                </span>
              </div>
              {attendanceResult.data.records.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {attendanceResult.data.records.map((record) => (
                    <li
                      key={record.id}
                      className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0 last:pb-0"
                    >
                      <span className="min-w-0 truncate">
                        {record.topic ?? record.sessionDate}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs capitalize">
                        {record.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {paymentPlanResult.ok ? (
        <StudentPaymentPlanCard plan={paymentPlanResult.data} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Payment Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <p role="alert" className="text-destructive text-sm">
              {paymentPlanResult.error}
            </p>
          </CardContent>
        </Card>
      )}

      {materialsResult.ok ? (
        <StudentMaterialsCard materials={materialsResult.data} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Materials</CardTitle>
          </CardHeader>
          <CardContent>
            <p role="alert" className="text-destructive text-sm">
              {materialsResult.error}
            </p>
          </CardContent>
        </Card>
      )}

      {assignmentsResult.ok ? (
        <StudentAssignmentsCard assignments={assignmentsResult.data} enrollmentId={id} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Assignments</CardTitle>
          </CardHeader>
          <CardContent>
            <p role="alert" className="text-destructive text-sm">
              {assignmentsResult.error}
            </p>
          </CardContent>
        </Card>
      )}

      {certificatesResult.ok ? (
        <StudentCertificatesCard certificates={certificatesResult.data} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Certificates</CardTitle>
          </CardHeader>
          <CardContent>
            <p role="alert" className="text-destructive text-sm">
              {certificatesResult.error}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
