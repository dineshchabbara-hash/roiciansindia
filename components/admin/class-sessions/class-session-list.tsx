import Link from "next/link";
import { ClassSessionStatusBadge } from "@/components/admin/class-sessions/class-session-status-badge";
import type { ClassSessionRow } from "@/lib/data/class-sessions";

export function ClassSessionList({
  batchId,
  sessions,
}: {
  batchId: string;
  sessions: ClassSessionRow[];
}) {
  if (sessions.length === 0) {
    return (
      <p className="text-muted-foreground py-4 text-center text-sm">
        No class sessions scheduled for this batch yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {sessions.map((session) => (
        <li
          key={session.id}
          className="flex items-center justify-between gap-3 border-b pb-2 last:border-0"
        >
          <div className="min-w-0">
            <Link
              href={`/admin/batches/${batchId}/sessions/${session.id}`}
              className="truncate text-sm font-medium hover:underline"
            >
              {session.topic ?? session.sessionDate}
            </Link>
            <p className="text-muted-foreground truncate text-xs">
              {session.sessionDate}
              {session.startTime && (
                <>
                  {" · "}
                  {session.startTime.slice(0, 5)}
                  {session.endTime ? `–${session.endTime.slice(0, 5)}` : ""}
                </>
              )}
              {session.trainerName ? ` · ${session.trainerName}` : ""}
            </p>
          </div>
          <ClassSessionStatusBadge status={session.status} />
        </li>
      ))}
    </ul>
  );
}
