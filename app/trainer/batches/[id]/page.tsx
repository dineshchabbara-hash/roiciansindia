import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrainerStudentTable } from "@/components/trainer/trainer-student-table";
import { TrainerClassSessionList } from "@/components/trainer/trainer-class-session-list";
import { TrainerMaterialsCard } from "@/components/trainer/materials/trainer-materials-card";
import { AssignmentsCard } from "@/components/admin/assignments/assignments-card";
import { TrainerSubmissionsSection } from "@/components/trainer/assignments/trainer-submissions-section";
import {
  getMyBatch,
  getMySessionsForBatch,
  getMyStudentsForBatch,
  getMyAssignmentsForBatch,
} from "@/lib/data/trainer-portal";
import { getMaterialsForScope, listProgramModules } from "@/lib/data/materials";
import { createMyBatchMaterialAction } from "@/lib/actions/trainer-materials";
import {
  createMyBatchAssignmentAction,
  updateMyAssignmentStatusAction,
} from "@/lib/actions/trainer-assignments";

export const dynamic = "force-dynamic";

// Direct-URL/ID-manipulation defense point (IMPLEMENTATION_PLAN.md Phase 11
// DoD): getMyBatch (lib/data/trainer-portal.ts) scopes its query by BOTH
// this id AND the caller's own resolved trainer id (via batch_trainers). An
// unassigned batch's id therefore comes back identically to a genuinely
// nonexistent one — notFound() either way — never a distinct "not yours"
// response that would confirm the id exists.
export default async function TrainerBatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [
    batchResult,
    studentsResult,
    sessionsResult,
    materialsResult,
    assignmentsResult,
  ] = await Promise.all([
    getMyBatch(id),
    getMyStudentsForBatch(id),
    getMySessionsForBatch(id),
    getMaterialsForScope({ type: "batch", id }),
    getMyAssignmentsForBatch(id),
  ]);

  if (!batchResult.ok) {
    if (batchResult.error === "Batch not found.") {
      notFound();
    }
    return (
      <p role="alert" className="text-destructive text-sm">
        {batchResult.error}
      </p>
    );
  }

  const batch = batchResult.data;
  const moduleOptionsResult = await listProgramModules(batch.programId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{batch.name}</h1>
        <Badge variant="outline" className="capitalize">
          {batch.status.replace("_", " ")}
        </Badge>
        {batch.isPrimary && <Badge variant="secondary">Primary</Badge>}
      </div>
      <p className="text-muted-foreground text-sm">
        {batch.programName} ({batch.programCode})
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">Start date</p>
            <p>{batch.startDate}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">End date</p>
            <p>{batch.expectedEndDate ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Delivery mode</p>
            <p className="capitalize">{batch.deliveryMode?.replace("_", " ") ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Days</p>
            <p>{batch.daysOfWeek.length > 0 ? batch.daysOfWeek.join(", ") : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Time</p>
            <p>
              {batch.startTime && batch.endTime
                ? `${batch.startTime}–${batch.endTime} (${batch.timezone})`
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Location</p>
            <p>{batch.location ?? batch.meetingLink ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Class Sessions</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/trainer/batches/${batch.id}/sessions/new`}>Add session</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {sessionsResult.ok ? (
            <TrainerClassSessionList batchId={batch.id} sessions={sessionsResult.data} />
          ) : (
            <p role="alert" className="text-destructive text-sm">
              {sessionsResult.error}
            </p>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-medium">Students in this batch</h2>
        {studentsResult.ok ? (
          <TrainerStudentTable students={studentsResult.data} />
        ) : (
          <p role="alert" className="text-destructive text-sm">
            {studentsResult.error}
          </p>
        )}
      </div>

      {materialsResult.ok ? (
        <TrainerMaterialsCard
          materials={materialsResult.data}
          action={createMyBatchMaterialAction.bind(null, batch.id)}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Materials</CardTitle>
          </CardHeader>
          <CardContent>
            <p role="alert" className="text-destructive text-sm">
              {materialsResult.error}
            </p>
          </CardContent>
        </Card>
      )}

      {assignmentsResult.ok ? (
        <AssignmentsCard
          assignments={assignmentsResult.data}
          action={createMyBatchAssignmentAction.bind(null, batch.id)}
          statusAction={(assignmentId) =>
            updateMyAssignmentStatusAction.bind(null, assignmentId, batch.id)
          }
          renderSubmissions={(assignment) => (
            <TrainerSubmissionsSection
              batchId={batch.id}
              assignmentId={assignment.id}
              maxMarks={assignment.maxMarks}
            />
          )}
          moduleOptions={moduleOptionsResult.ok ? moduleOptionsResult.data : []}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Assignments</CardTitle>
          </CardHeader>
          <CardContent>
            <p role="alert" className="text-destructive text-sm">
              {assignmentsResult.error}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
