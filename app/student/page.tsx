import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  getMyStudentProfile,
  getMyEnrollments,
  getMyUpcomingClassSessions,
  getMyAttendanceSummary,
} from "@/lib/data/student-portal";
import { StudentEnrollmentCard } from "@/components/student/student-enrollment-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatPaiseAsINR } from "@/lib/domain/money";

export const dynamic = "force-dynamic";

// Phase 10 scope (IMPLEMENTATION_PLAN.md): identity, current programs/
// batches, and payment status using Phase 9 data. Phase 12 closed the
// "Upcoming classes" placeholder with real class_sessions data (own enrolled
// batches only, via RLS). Phase 13 closes the "Attendance" placeholder with
// real data from student_attendance_summary (FR-44/62 — computed percentage,
// never hand-maintained). Announcements (also listed under FR-40) has no
// backing data model anywhere in this codebase yet, so it is omitted rather
// than fabricated — also noted in the report.
export default async function StudentHome() {
  const user = await getCurrentUserContext();
  if (!user) {
    redirect("/login/student");
  }

  const [profileResult, enrollmentsResult, upcomingResult, attendanceResult] =
    await Promise.all([
      getMyStudentProfile(),
      getMyEnrollments(),
      getMyUpcomingClassSessions(5),
      getMyAttendanceSummary(),
    ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Welcome{profileResult.ok ? `, ${profileResult.data.firstName}` : ""}
        </h1>
        {profileResult.ok && (
          <p className="text-muted-foreground text-sm">
            {profileResult.data.studentCode}
          </p>
        )}
        {!profileResult.ok && (
          <p role="alert" className="text-destructive text-sm">
            {profileResult.error}
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payment status</CardTitle>
          <CardDescription>Across all of your enrollments.</CardDescription>
        </CardHeader>
        <CardContent>
          {enrollmentsResult.ok ? (
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold">
                {formatPaiseAsINR(
                  enrollmentsResult.data.reduce((sum, e) => sum + e.outstandingPaise, 0),
                )}
              </span>
              <span className="text-muted-foreground text-sm">outstanding</span>
            </div>
          ) : (
            <p role="alert" className="text-destructive text-sm">
              {enrollmentsResult.error}
            </p>
          )}
        </CardContent>
      </Card>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Your programs</h2>
          <Link
            href="/student/enrollments"
            className="text-primary text-sm hover:underline"
          >
            View all
          </Link>
        </div>
        {enrollmentsResult.ok ? (
          enrollmentsResult.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              You don&apos;t have any enrollments yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {enrollmentsResult.data.slice(0, 4).map((enrollment) => (
                <StudentEnrollmentCard key={enrollment.id} enrollment={enrollment} />
              ))}
            </div>
          )
        ) : (
          <p role="alert" className="text-destructive text-sm">
            {enrollmentsResult.error}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming classes</CardTitle>
          </CardHeader>
          <CardContent>
            {!upcomingResult.ok ? (
              <p role="alert" className="text-destructive text-sm">
                {upcomingResult.error}
              </p>
            ) : upcomingResult.data.length === 0 ? (
              <p className="text-muted-foreground text-sm">No upcoming classes</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {upcomingResult.data.map((session) => (
                  <li
                    key={session.id}
                    className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{session.batchName}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {session.programName}
                      </p>
                    </div>
                    <div className="text-muted-foreground shrink-0 text-right text-xs">
                      <p>{session.sessionDate}</p>
                      {session.startTime && (
                        <p>
                          {session.startTime.slice(0, 5)}
                          {session.endTime ? `–${session.endTime.slice(0, 5)}` : ""}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Attendance</CardTitle>
            <CardDescription>
              Per enrollment, computed from marked sessions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!attendanceResult.ok ? (
              <p role="alert" className="text-destructive text-sm">
                {attendanceResult.error}
              </p>
            ) : attendanceResult.data.length === 0 ? (
              <p className="text-muted-foreground text-sm">No attendance records yet</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {attendanceResult.data.map((summary) => {
                  const enrollment = enrollmentsResult.ok
                    ? enrollmentsResult.data.find((e) => e.id === summary.enrollmentId)
                    : undefined;
                  return (
                    <li key={summary.enrollmentId}>
                      <Link
                        href={`/student/enrollments/${summary.enrollmentId}`}
                        className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0 hover:underline"
                      >
                        <span className="min-w-0 truncate text-sm font-medium">
                          {enrollment?.programName ?? "Enrollment"}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {summary.attendancePercentage !== null
                            ? `${summary.attendancePercentage}%`
                            : "—"}{" "}
                          ({summary.totalSessions} session
                          {summary.totalSessions === 1 ? "" : "s"})
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
