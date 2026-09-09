import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrainerFilters } from "@/components/admin/trainers/trainer-filters";
import { TrainerTable } from "@/components/admin/trainers/trainer-table";
import { Pagination } from "@/components/admin/pagination";
import { searchTrainers, type TrainerSearchParams } from "@/lib/data/trainers";
import { isTrainerStatus } from "@/lib/domain/trainers";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  status?: string;
  page?: string;
};

export default async function TrainersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const status = isTrainerStatus(params.status) ? params.status : undefined;
  const searchInput: TrainerSearchParams = {
    q: params.q,
    status,
    page: params.page ? Number(params.page) : 1,
  };

  const trainersResult = await searchTrainers(searchInput);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Trainers</h1>
          <p className="text-muted-foreground text-sm">
            Search, filter, and manage trainer accounts.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/trainers/new">Add Trainer</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <TrainerFilters q={params.q} status={params.status} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {!trainersResult.ok ? (
            <p role="alert" className="text-destructive text-sm">
              {trainersResult.error}
            </p>
          ) : (
            <>
              <TrainerTable trainers={trainersResult.data.trainers} />
              <Pagination
                page={trainersResult.data.page}
                pageSize={trainersResult.data.pageSize}
                total={trainersResult.data.total}
                basePath="/admin/trainers"
                searchParams={{ q: params.q, status: params.status }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
