import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TrainerAssignmentRow } from "@/lib/data/trainers";

/**
 * Read-only display of already-existing batch_trainers/batches/programs
 * data (mirrors components/admin/students/student-enrollment-history-card.tsx's
 * pattern). Batch Management and Program Management themselves are out of
 * Phase 6 scope — this never lets an Admin create/edit an assignment here.
 */
export function TrainerAssignmentsCard({
  data,
  error,
}: {
  data?: TrainerAssignmentRow[];
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assigned Batches</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : !data || data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No batch assignments yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.map((assignment) => (
              <li
                key={assignment.id}
                className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium">{assignment.batchName}</p>
                  <p className="text-muted-foreground text-xs">
                    {assignment.programName}
                    {assignment.isPrimary ? " · Primary trainer" : ""}
                  </p>
                </div>
                <Badge>{assignment.batchStatus}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
