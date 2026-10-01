import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrainerClassSessionStatusControl } from "@/components/trainer/trainer-class-session-status-control";
import { getMySession } from "@/lib/data/trainer-portal";

export const dynamic = "force-dynamic";

// Direct-URL/ID-manipulation defense (Phase 12): getMySession scopes by the
// caller's own batch assignment AND the session's own batch id — a session
// belonging to an unassigned batch, or to a different batch than this
// route's own [id] segment, 404s identically to a nonexistent one.
export default async function TrainerClassSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const result = await getMySession(id, sessionId);

  if (!result.ok) {
    if (
      result.error === "Class session not found." ||
      result.error === "Batch not found."
    ) {
      notFound();
    }
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }

  const session = result.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{session.topic ?? "Class session"}</h1>
            <Badge variant="outline" className="capitalize">
              {session.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            <Link href={`/trainer/batches/${id}`} className="hover:underline">
              Back to batch
            </Link>
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/trainer/batches/${id}/sessions/${session.id}/edit`}>Edit</Link>
        </Button>
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
          <TrainerClassSessionStatusControl
            batchId={id}
            sessionId={session.id}
            currentStatus={session.status}
          />
        </CardContent>
      </Card>
    </div>
  );
}
