import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { StudentEnrollmentHistoryRow } from "@/lib/data/students";

export function StudentEnrollmentHistoryCard({
  data,
  error,
}: {
  data?: StudentEnrollmentHistoryRow[];
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enrollment History</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : !data || data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No enrollments yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.map((enrollment) => (
              <li
                key={enrollment.id}
                className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium">{enrollment.programName}</p>
                  <p className="text-muted-foreground text-xs">
                    {enrollment.batchName ?? "No batch assigned"} ·{" "}
                    {enrollment.enrollmentCode}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge>{enrollment.status}</Badge>
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
