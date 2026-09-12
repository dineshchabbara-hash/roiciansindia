import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BatchFilters } from "@/components/admin/batches/batch-filters";
import { BatchTable } from "@/components/admin/batches/batch-table";
import { Pagination } from "@/components/admin/pagination";
import {
  getProgramOptions,
  getTrainerOptions,
  searchBatches,
  type BatchSearchParams,
} from "@/lib/data/batches";
import { isBatchStatus } from "@/lib/domain/batches";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  programId?: string;
  trainerId?: string;
  status?: string;
  page?: string;
};

export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const status = isBatchStatus(params.status) ? params.status : undefined;
  const searchInput: BatchSearchParams = {
    q: params.q,
    programId: params.programId,
    trainerId: params.trainerId,
    status,
    page: params.page ? Number(params.page) : 1,
  };

  const [batchesResult, programOptionsResult, trainerOptionsResult] = await Promise.all([
    searchBatches(searchInput),
    getProgramOptions(),
    getTrainerOptions(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Batches</h1>
          <p className="text-muted-foreground text-sm">
            Schedule and manage batches for each program.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/batches/new">Add Batch</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <BatchFilters
            q={params.q}
            programId={params.programId}
            trainerId={params.trainerId}
            status={params.status}
            programOptions={programOptionsResult.ok ? programOptionsResult.data : []}
            trainerOptions={trainerOptionsResult.ok ? trainerOptionsResult.data : []}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {!batchesResult.ok ? (
            <p role="alert" className="text-destructive text-sm">
              {batchesResult.error}
            </p>
          ) : (
            <>
              <BatchTable batches={batchesResult.data.batches} />
              <Pagination
                page={batchesResult.data.page}
                pageSize={batchesResult.data.pageSize}
                total={batchesResult.data.total}
                basePath="/admin/batches"
                searchParams={{
                  q: params.q,
                  programId: params.programId,
                  trainerId: params.trainerId,
                  status: params.status,
                }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
