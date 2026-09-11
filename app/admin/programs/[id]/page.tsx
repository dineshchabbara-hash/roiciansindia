import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProgramStatusBadge } from "@/components/admin/programs/program-status-badge";
import { ProgramStatusControl } from "@/components/admin/programs/program-status-control";
import { ProgramBatchesCard } from "@/components/admin/programs/program-batches-card";
import {
  getProgramBatches,
  getProgramProfile,
  getProgramRelatedSummary,
} from "@/lib/data/programs";
import { formatPaiseAsINR, toPaise } from "@/lib/domain/money";

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

async function BatchesSection({ programId }: { programId: string }) {
  const [summaryResult, batchesResult] = await Promise.all([
    getProgramRelatedSummary(programId),
    getProgramBatches(programId),
  ]);

  if (!summaryResult.ok) {
    return <ProgramBatchesCard error={summaryResult.error} />;
  }
  if (!batchesResult.ok) {
    return <ProgramBatchesCard error={batchesResult.error} />;
  }

  return <ProgramBatchesCard summary={summaryResult.data} batches={batchesResult.data} />;
}

export default async function ProgramProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profileResult = await getProgramProfile(id);

  if (!profileResult.ok) {
    notFound();
  }

  const program = profileResult.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{program.name}</h1>
            <ProgramStatusBadge status={program.status} />
          </div>
          <p className="text-muted-foreground font-mono text-sm">{program.programCode}</p>
        </div>
        <div className="flex items-center gap-2">
          <ProgramStatusControl programId={program.id} currentStatus={program.status} />
          <Button variant="outline" asChild>
            <Link href={`/admin/programs/${program.id}/edit`}>Edit</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Program Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">Category</p>
            <p>{program.category ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Duration</p>
            <p>
              {program.durationValue !== null && program.durationUnit !== null
                ? `${program.durationValue} ${program.durationUnit}`
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Delivery mode</p>
            <p>{program.deliveryMode?.replace("_", " ") ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Regular fee</p>
            <p>{formatPaiseAsINR(toPaise(program.regularFee))}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Registration fee</p>
            <p>{formatPaiseAsINR(toPaise(program.registrationFee))}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Tax rate</p>
            <p>
              {program.taxRatePercent !== null
                ? `${program.taxRatePercent}%`
                : "Company default"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Certificate eligible</p>
            <p>{program.certificateEligible ? "Yes" : "No"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Installments allowed</p>
            <p>{program.installmentsAllowed ? "Yes" : "No"}</p>
          </div>
          <div className="col-span-2 md:col-span-3">
            <p className="text-muted-foreground text-xs">Description</p>
            <p className="whitespace-pre-wrap">{program.description ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Suspense fallback={<SectionSkeleton />}>
          <BatchesSection programId={program.id} />
        </Suspense>
      </div>
    </div>
  );
}
