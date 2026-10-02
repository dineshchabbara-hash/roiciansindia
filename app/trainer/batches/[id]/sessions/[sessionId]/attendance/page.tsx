import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrainerAttendanceRosterForm } from "@/components/trainer/trainer-attendance-roster-form";
import { getMySession, getMyEligibleRosterForSession } from "@/lib/data/trainer-portal";

export const dynamic = "force-dynamic";

// Direct-URL/ID-manipulation defense (Phase 13, same pattern as every other
// Trainer batch/session route): getMySession/getMyEligibleRosterForSession
// scope by the caller's own batch assignment AND the session's own batch id
// — an unassigned batch, or a session belonging to a different batch than
// this route's own [id] segment, 404s identically to a nonexistent one.
export default async function TrainerClassSessionAttendancePage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const [sessionResult, rosterResult] = await Promise.all([
    getMySession(id, sessionId),
    getMyEligibleRosterForSession(id, sessionId),
  ]);

  if (!sessionResult.ok) {
    if (
      sessionResult.error === "Class session not found." ||
      sessionResult.error === "Batch not found."
    ) {
      notFound();
    }
    return (
      <p role="alert" className="text-destructive text-sm">
        {sessionResult.error}
      </p>
    );
  }
  if (!rosterResult.ok) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {rosterResult.error}
      </p>
    );
  }

  const session = sessionResult.data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Attendance</h1>
        <p className="text-muted-foreground text-sm">
          <Link
            href={`/trainer/batches/${id}/sessions/${session.id}`}
            className="hover:underline"
          >
            {session.topic ?? "Class session"}
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
          <TrainerAttendanceRosterForm
            batchId={id}
            sessionId={session.id}
            roster={rosterResult.data}
          />
        </CardContent>
      </Card>
    </div>
  );
}
