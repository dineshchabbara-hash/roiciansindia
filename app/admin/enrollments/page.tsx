import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EnrollmentFilters } from "@/components/admin/enrollments/enrollment-filters";
import { EnrollmentTable } from "@/components/admin/enrollments/enrollment-table";
import { Pagination } from "@/components/admin/pagination";
import {
  getBatchOptionsForEnrollment,
  getProgramPricingOptions,
  getStudentOptions,
  searchEnrollments,
  type EnrollmentSearchParams,
} from "@/lib/data/enrollments";
import { isEnrollmentStatus } from "@/lib/domain/enrollments";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  studentId?: string;
  programId?: string;
  batchId?: string;
  status?: string;
  page?: string;
};

export default async function EnrollmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const status = isEnrollmentStatus(params.status) ? params.status : undefined;
  const searchInput: EnrollmentSearchParams = {
    q: params.q,
    studentId: params.studentId,
    programId: params.programId,
    batchId: params.batchId,
    status,
    page: params.page ? Number(params.page) : 1,
  };

  const [
    enrollmentsResult,
    studentOptionsResult,
    programOptionsResult,
    batchOptionsResult,
  ] = await Promise.all([
    searchEnrollments(searchInput),
    getStudentOptions(),
    getProgramPricingOptions(),
    getBatchOptionsForEnrollment(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Enrollments</h1>
          <p className="text-muted-foreground text-sm">
            Manage student enrollments, commercial terms, and status.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/enrollments/new">Add Enrollment</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <EnrollmentFilters
            q={params.q}
            studentId={params.studentId}
            programId={params.programId}
            batchId={params.batchId}
            status={params.status}
            studentOptions={studentOptionsResult.ok ? studentOptionsResult.data : []}
            programOptions={programOptionsResult.ok ? programOptionsResult.data : []}
            batchOptions={batchOptionsResult.ok ? batchOptionsResult.data : []}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {!enrollmentsResult.ok ? (
            <p role="alert" className="text-destructive text-sm">
              {enrollmentsResult.error}
            </p>
          ) : (
            <>
              <EnrollmentTable enrollments={enrollmentsResult.data.enrollments} />
              <Pagination
                page={enrollmentsResult.data.page}
                pageSize={enrollmentsResult.data.pageSize}
                total={enrollmentsResult.data.total}
                basePath="/admin/enrollments"
                searchParams={{
                  q: params.q,
                  studentId: params.studentId,
                  programId: params.programId,
                  batchId: params.batchId,
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
