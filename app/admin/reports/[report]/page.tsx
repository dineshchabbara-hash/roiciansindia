import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination } from "@/components/admin/pagination";
import { ReportFiltersForm } from "@/components/admin/reports/report-filters";
import { ReportTable } from "@/components/admin/reports/report-table";
import { ReportResultSummary } from "@/components/admin/reports/report-result-summary";
import { FinancialTotals } from "@/components/admin/reports/financial-totals";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";
import {
  getFinancialReportTotals,
  getReportFilterOptions,
  getReportPage,
} from "@/lib/data/reports";
import {
  REPORT_DEFINITIONS,
  isReportKind,
  parseReportFilters,
  reportExportHref,
  reportFiltersToParams,
  type RawSearchParams,
} from "@/lib/domain/reports";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  // Defense in depth on top of the /admin layout gate: never start report
  // queries for a non-Admin request.
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const { report } = await params;
  if (!isReportKind(report)) notFound();
  const kind = report;
  const def = REPORT_DEFINITIONS[kind];
  const filters = parseReportFilters(kind, await searchParams);

  const [pageResult, optionsResult, totalsResult] = await Promise.all([
    getReportPage(kind, filters),
    getReportFilterOptions(),
    kind === "financial" ? getFinancialReportTotals(filters) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/admin/reports"
          className="text-muted-foreground text-sm hover:underline"
        >
          ← All reports
        </Link>
        <h1 className="text-2xl font-semibold">{def.title}</h1>
        <p className="text-muted-foreground text-sm">{def.description}</p>
        {kind === "attendance" && (
          <p className="text-muted-foreground text-xs">
            Only enrollments with at least one marked session appear. Attendance % is
            (Present + Late) ÷ sessions marked — the same figure students see.
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2 className="text-base">Filters</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!optionsResult.ok && (
            <p role="alert" className="text-destructive mb-3 text-sm">
              {optionsResult.error}
            </p>
          )}
          <ReportFiltersForm
            kind={kind}
            filters={filters}
            programs={optionsResult.ok ? optionsResult.data.programs : []}
            batches={optionsResult.ok ? optionsResult.data.batches : []}
          />
        </CardContent>
      </Card>

      {totalsResult && (
        <Card>
          <CardContent>
            {totalsResult.ok ? (
              <FinancialTotals totals={totalsResult.data} group={filters.group} />
            ) : (
              <p role="alert" className="text-destructive text-sm">
                {totalsResult.error}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4">
          {!pageResult.ok ? (
            <p role="alert" className="text-destructive text-sm">
              {pageResult.error}
            </p>
          ) : (
            <>
              <ReportResultSummary
                total={pageResult.data.total}
                page={pageResult.data.page}
                pageSize={pageResult.data.pageSize}
                rowsOnPage={pageResult.data.rows.length}
                exportHref={reportExportHref(kind, filters)}
              />
              <ReportTable kind={kind} rows={pageResult.data.rows} />
              <Pagination
                page={pageResult.data.page}
                pageSize={pageResult.data.pageSize}
                total={pageResult.data.total}
                basePath={`/admin/reports/${kind}`}
                searchParams={reportFiltersToParams(kind, filters)}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
