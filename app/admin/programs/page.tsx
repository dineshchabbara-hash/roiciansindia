import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgramFilters } from "@/components/admin/programs/program-filters";
import { ProgramTable } from "@/components/admin/programs/program-table";
import { Pagination } from "@/components/admin/pagination";
import { searchPrograms, type ProgramSearchParams } from "@/lib/data/programs";
import { isProgramStatus } from "@/lib/domain/programs";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  status?: string;
  page?: string;
};

export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const status = isProgramStatus(params.status) ? params.status : undefined;
  const searchInput: ProgramSearchParams = {
    q: params.q,
    status,
    page: params.page ? Number(params.page) : 1,
  };

  const programsResult = await searchPrograms(searchInput);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Programs</h1>
          <p className="text-muted-foreground text-sm">
            Create and manage the course/program catalog.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/programs/new">Add Program</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <ProgramFilters q={params.q} status={params.status} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {!programsResult.ok ? (
            <p role="alert" className="text-destructive text-sm">
              {programsResult.error}
            </p>
          ) : (
            <>
              <ProgramTable programs={programsResult.data.programs} />
              <Pagination
                page={programsResult.data.page}
                pageSize={programsResult.data.pageSize}
                total={programsResult.data.total}
                basePath="/admin/programs"
                searchParams={{ q: params.q, status: params.status }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
