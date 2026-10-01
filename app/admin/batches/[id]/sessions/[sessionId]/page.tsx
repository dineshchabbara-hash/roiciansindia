import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClassSessionStatusBadge } from "@/components/admin/class-sessions/class-session-status-badge";
import { ClassSessionStatusControl } from "@/components/admin/class-sessions/class-session-status-control";
import { getClassSession } from "@/lib/data/class-sessions";
import { getBatchProfile } from "@/lib/data/batches";

export const dynamic = "force-dynamic";

// Direct-URL/ID-manipulation defense (Phase 12): getClassSession scopes by
// BOTH the session id and this route's own batch id — a session that
// belongs to a different batch 404s identically to a nonexistent id, the
// same pattern established in Phase 10/11 for Enrollment/Batch/Student
// detail routes.
export default async function ClassSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const [batchResult, sessionResult] = await Promise.all([
    getBatchProfile(id),
    getClassSession(id, sessionId),
  ]);

  if (!batchResult.ok) {
    notFound();
  }
  if (!sessionResult.ok) {
    if (sessionResult.error === "Class session not found.") {
      notFound();
    }
    return (
      <p role="alert" className="text-destructive text-sm">
        {sessionResult.error}
      </p>
    );
  }

  const session = sessionResult.data;
  const batch = batchResult.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{session.topic ?? "Class session"}</h1>
            <ClassSessionStatusBadge status={session.status} />
          </div>
          <p className="text-muted-foreground text-sm">
            <Link href={`/admin/batches/${batch.id}`} className="hover:underline">
              {batch.name}
            </Link>{" "}
            ({batch.programName})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={`/admin/batches/${batch.id}/sessions/${session.id}/edit`}>
              Edit
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Session Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">Session date</p>
            <p>{session.sessionDate}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Time</p>
            <p>
              {session.startTime && session.endTime
                ? `${session.startTime.slice(0, 5)}–${session.endTime.slice(0, 5)}`
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Trainer</p>
            <p>{session.trainerName ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Meeting link</p>
            <p className="truncate">{session.meetingLink ?? "—"}</p>
          </div>
          <div className="col-span-2 md:col-span-3">
            <p className="text-muted-foreground text-xs">Description</p>
            <p className="whitespace-pre-wrap">{session.description ?? "—"}</p>
          </div>
          <div className="col-span-2 md:col-span-3">
            <p className="text-muted-foreground text-xs">Notes</p>
            <p className="whitespace-pre-wrap">{session.notes ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <ClassSessionStatusControl
            batchId={batch.id}
            sessionId={session.id}
            currentStatus={session.status}
          />
        </CardContent>
      </Card>
    </div>
  );
}
