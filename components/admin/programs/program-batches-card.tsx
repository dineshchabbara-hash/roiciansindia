import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ProgramBatchRow, ProgramRelatedSummary } from "@/lib/data/programs";

/**
 * Read-only display of already-existing batches/enrollments linked to this
 * Program (mirrors components/admin/trainers/trainer-assignments-card.tsx's
 * pattern). Batch Management and Enrollment Management themselves are out
 * of Phase 7 scope — this never lets an Admin create/edit a batch or
 * enrollment here.
 */
export function ProgramBatchesCard({
  summary,
  batches,
  error,
}: {
  summary?: ProgramRelatedSummary;
  batches?: ProgramBatchRow[];
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Batches & Enrollments</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : (
          <>
            {summary && (
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Batches</p>
                  <p className="font-medium">{summary.batchCount}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Active batches</p>
                  <p className="font-medium">{summary.activeBatchCount}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Enrollments</p>
                  <p className="font-medium">{summary.enrollmentCount}</p>
                </div>
              </div>
            )}

            {!batches || batches.length === 0 ? (
              <p className="text-muted-foreground text-sm">No batches yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {batches.map((batch) => (
                  <li
                    key={batch.id}
                    className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-medium">{batch.name}</p>
                      <p className="text-muted-foreground text-xs">{batch.startDate}</p>
                    </div>
                    <Badge>{batch.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
