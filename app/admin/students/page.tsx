import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StudentFilters } from "@/components/admin/students/student-filters";
import { StudentTable } from "@/components/admin/students/student-table";
import { Pagination } from "@/components/admin/pagination";
import {
  getBatchFilterOptions,
  getProgramFilterOptions,
  searchStudents,
  type StudentSearchParams,
} from "@/lib/data/students";
import { isStudentStatus } from "@/lib/domain/students";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  status?: string;
  programId?: string;
  batchId?: string;
  page?: string;
};

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const status = isStudentStatus(params.status) ? params.status : undefined;
  const searchInput: StudentSearchParams = {
    q: params.q,
    status,
    programId: params.programId || undefined,
    batchId: params.batchId || undefined,
    page: params.page ? Number(params.page) : 1,
  };

  const [studentsResult, programsResult, batchesResult] = await Promise.all([
    searchStudents(searchInput),
    getProgramFilterOptions(),
    getBatchFilterOptions(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Students</h1>
          <p className="text-muted-foreground text-sm">
            Search, filter, and manage student records.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/students/new">Add Student</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <StudentFilters
            q={params.q}
            status={params.status}
            programId={params.programId}
            batchId={params.batchId}
            programs={programsResult.ok ? programsResult.data : []}
            batches={batchesResult.ok ? batchesResult.data : []}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {!studentsResult.ok ? (
            <p role="alert" className="text-destructive text-sm">
              {studentsResult.error}
            </p>
          ) : (
            <>
              <StudentTable students={studentsResult.data.students} />
              <Pagination
                page={studentsResult.data.page}
                pageSize={studentsResult.data.pageSize}
                total={studentsResult.data.total}
                basePath="/admin/students"
                searchParams={{
                  q: params.q,
                  status: params.status,
                  programId: params.programId,
                  batchId: params.batchId,
                }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
