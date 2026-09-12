import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BatchStatusBadge } from "@/components/admin/batches/batch-status-badge";
import { BatchStatusControl } from "@/components/admin/batches/batch-status-control";
import { BatchTrainerAssignmentsCard } from "@/components/admin/batches/batch-trainer-assignments-card";
import {
  getBatchEnrollmentCount,
  getBatchProfile,
  getBatchTrainerAssignments,
  getTrainerOptions,
} from "@/lib/data/batches";
import { formatDaysOfWeekForDisplay } from "@/lib/domain/batches";

export const dynamic = "force-dynamic";

function SectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}

async function TrainersSection({ batchId }: { batchId: string }) {
  const [assignmentsResult, trainerOptionsResult] = await Promise.all([
    getBatchTrainerAssignments(batchId),
    getTrainerOptions(),
  ]);

  if (!assignmentsResult.ok) {
    return (
      <BatchTrainerAssignmentsCard batchId={batchId} error={assignmentsResult.error} />
    );
  }

  return (
    <BatchTrainerAssignmentsCard
      batchId={batchId}
      assignments={assignmentsResult.data}
      trainerOptions={trainerOptionsResult.ok ? trainerOptionsResult.data : []}
    />
  );
}

async function EnrollmentSummaryCard({ batchId }: { batchId: string }) {
  const result = await getBatchEnrollmentCount(batchId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enrollments</CardTitle>
      </CardHeader>
      <CardContent>
        {!result.ok ? (
          <p role="alert" className="text-destructive text-sm">
            {result.error}
          </p>
        ) : (
          <p className="text-sm">
            <span className="font-medium">{result.data}</span> enrolled
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function BatchProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profileResult = await getBatchProfile(id);

  if (!profileResult.ok) {
    notFound();
  }

  const batch = profileResult.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{batch.name}</h1>
            <BatchStatusBadge status={batch.status} />
          </div>
          <p className="text-muted-foreground text-sm">
            <Link href={`/admin/programs/${batch.programId}`} className="hover:underline">
              {batch.programName} ({batch.programCode})
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BatchStatusControl batchId={batch.id} currentStatus={batch.status} />
          <Button variant="outline" asChild>
            <Link href={`/admin/batches/${batch.id}/edit`}>Edit</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Batch Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">Start date</p>
            <p>{batch.startDate}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Expected end date</p>
            <p>{batch.expectedEndDate ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Days of week</p>
            <p>
              {batch.daysOfWeek.length > 0
                ? formatDaysOfWeekForDisplay(batch.daysOfWeek)
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Time</p>
            <p>
              {batch.startTime && batch.endTime
                ? `${batch.startTime.slice(0, 5)}–${batch.endTime.slice(0, 5)}`
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Timezone</p>
            <p>{batch.timezone}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Delivery mode</p>
            <p>{batch.deliveryMode?.replace("_", " ") ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Capacity</p>
            <p>{batch.capacity ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Location</p>
            <p>{batch.location ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Meeting link</p>
            <p className="truncate">{batch.meetingLink ?? "—"}</p>
          </div>
          <div className="col-span-2 md:col-span-3">
            <p className="text-muted-foreground text-xs">Notes</p>
            <p className="whitespace-pre-wrap">{batch.notes ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Suspense fallback={<SectionSkeleton />}>
          <TrainersSection batchId={batch.id} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton />}>
          <EnrollmentSummaryCard batchId={batch.id} />
        </Suspense>
      </div>
    </div>
  );
}
