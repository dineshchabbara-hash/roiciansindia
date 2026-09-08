import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StudentAttendanceHistoryRow } from "@/lib/data/students";

export function StudentAttendanceHistoryCard({
  data,
  error,
}: {
  data?: StudentAttendanceHistoryRow[];
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance History</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : !data || data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No attendance recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.map((row) => (
              <li
                key={row.enrollmentId}
                className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium">
                    {row.batchName ?? "Unknown batch"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {row.presentCount} present · {row.absentCount} absent ·{" "}
                    {row.lateCount} late · {row.excusedCount} excused ({row.totalSessions}{" "}
                    sessions)
                  </p>
                </div>
                <span className="text-sm font-medium">
                  {row.attendancePercentage !== null
                    ? `${row.attendancePercentage}%`
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
