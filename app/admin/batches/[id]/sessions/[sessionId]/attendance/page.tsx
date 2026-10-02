import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AttendanceRosterForm } from "@/components/admin/attendance/attendance-roster-form";
import { getEligibleRosterForClassSession } from "@/lib/data/attendance";

export const dynamic = "force-dynamic";

// Direct-URL/ID-manipulation defense (Phase 13, same pattern as every other
// nested batch/session route): getEligibleRosterForClassSession scopes by
// BOTH the session id and this route's own batch id via getClassSession — a
// session belonging to a different batch 404s identically to a nonexistent
// one.
export default async function ClassSessionAttendancePage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const result = await getEligibleRosterForClassSession(id, sessionId);

  if (!result.ok) {
    if (result.error === "Class session not found.") {
      notFound();
    }
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }

  const { session, roster } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Attendance</h1>
        <p className="text-muted-foreground text-sm">
          <Link
            href={`/admin/batches/${session.batchId}/sessions/${session.classSessionId}`}
            className="hover:underline"
          >
            {session.topic ?? session.sessionDate}
          </Link>{" "}
          — {session.sessionDate}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mark attendance</CardTitle>
          <CardDescription>
            Only students enrolled in this session&apos;s batch are listed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AttendanceRosterForm
            batchId={session.batchId}
            sessionId={session.classSessionId}
            roster={roster}
          />
        </CardContent>
      </Card>
    </div>
  );
}
