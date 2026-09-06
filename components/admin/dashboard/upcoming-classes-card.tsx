import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UpcomingClassSession } from "@/lib/data/dashboard";

export function UpcomingClassesCard({
  data,
  error,
}: {
  data?: UpcomingClassSession[];
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Classes</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : !data || data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No upcoming classes</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.map((session) => (
              <li
                key={session.id}
                className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{session.batchName}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {session.programName}
                    {session.trainerName ? ` · ${session.trainerName}` : ""}
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
  );
}
