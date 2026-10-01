import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { MyClassSessionRow } from "@/lib/data/trainer-portal";

export function TrainerClassSessionList({
  batchId,
  sessions,
}: {
  batchId: string;
  sessions: MyClassSessionRow[];
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
              href={`/trainer/batches/${batchId}/sessions/${session.id}`}
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
          <Badge variant="outline" className="capitalize">
            {session.status}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
