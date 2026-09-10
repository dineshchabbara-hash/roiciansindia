import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TrainerStatusBadge } from "@/components/admin/trainers/trainer-status-badge";
import { TrainerStatusControl } from "@/components/admin/trainers/trainer-status-control";
import { TrainerAssignmentsCard } from "@/components/admin/trainers/trainer-assignments-card";
import { getTrainerAssignments, getTrainerProfile } from "@/lib/data/trainers";
import { formatSpecializationForDisplay } from "@/lib/domain/trainers";

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

async function AssignmentsSection({ trainerId }: { trainerId: string }) {
  const result = await getTrainerAssignments(trainerId);
  return result.ok ? (
    <TrainerAssignmentsCard data={result.data} />
  ) : (
    <TrainerAssignmentsCard error={result.error} />
  );
}

export default async function TrainerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profileResult = await getTrainerProfile(id);

  if (!profileResult.ok) {
    notFound();
  }

  const trainer = profileResult.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {trainer.firstName} {trainer.lastName}
            </h1>
            <TrainerStatusBadge status={trainer.status} />
          </div>
          <p className="text-muted-foreground text-sm">{trainer.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <TrainerStatusControl trainerId={trainer.id} currentStatus={trainer.status} />
          <Button variant="outline" asChild>
            <Link href={`/admin/trainers/${trainer.id}/edit`}>Edit</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contact & Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">Phone</p>
            <p>{trainer.phone ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Specialization</p>
            <p>
              {trainer.specialization.length > 0
                ? formatSpecializationForDisplay(trainer.specialization)
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Joined</p>
            <p>{trainer.createdAt.slice(0, 10)}</p>
          </div>
          <div className="col-span-2 md:col-span-3">
            <p className="text-muted-foreground text-xs">Bio</p>
            <p className="whitespace-pre-wrap">{trainer.bio ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Suspense fallback={<SectionSkeleton />}>
          <AssignmentsSection trainerId={trainer.id} />
        </Suspense>
      </div>
    </div>
  );
}
