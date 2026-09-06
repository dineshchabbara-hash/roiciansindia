import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { RecentEnrollment } from "@/lib/data/dashboard";

function statusVariant(
  status: string,
): "default" | "secondary" | "warning" | "destructive" {
  switch (status) {
    case "active":
    case "enrolled":
    case "completed":
      return "default";
    case "on_hold":
      return "warning";
    case "withdrawn":
    case "cancelled":
      return "destructive";
    default:
      return "secondary";
  }
}

export function RecentEnrollmentsCard({
  data,
  error,
}: {
  data?: RecentEnrollment[];
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Enrollments</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : !data || data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No recent enrollments</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.map((enrollment) => (
              <li
                key={enrollment.id}
                className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{enrollment.studentName}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {enrollment.programName}
                    {enrollment.batchName ? ` · ${enrollment.batchName}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={statusVariant(enrollment.status)}>
                    {enrollment.status}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {enrollment.enrollmentDate}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
