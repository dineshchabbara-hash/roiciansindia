import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";
import {
  getDashboardMetrics,
  getEnrollmentFinancialClassificationSummary,
} from "@/lib/data/dashboard";
import { getReportsOverview } from "@/lib/data/reports";
import {
  ReportsOverview,
  type ReportsOverviewData,
} from "@/components/admin/reports/reports-overview";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  // Defense in depth on top of the /admin layout gate: never start report
  // queries for a non-Admin request.
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const [metrics, classification, overview] = await Promise.all([
    getDashboardMetrics(),
    getEnrollmentFinancialClassificationSummary(),
    getReportsOverview(),
  ]);

  const data: ReportsOverviewData = {
    students: metrics.ok
      ? { total: metrics.data.totalStudents, active: metrics.data.activeStudents }
      : null,
    enrollments:
      metrics.ok && classification.ok
        ? {
            confirmed: metrics.data.confirmedEnrollmentsCount,
            pipeline: classification.data.pipelineEnrollmentCount,
            cancelledOrWithdrawn: classification.data.cancelledOrWithdrawnCount,
          }
        : null,
    finance: metrics.ok
      ? {
          revenueCollectedPaise: metrics.data.revenueCollectedPaise,
          confirmedUnpaidFeesPaise: metrics.data.confirmedUnpaidFeesPaise,
        }
      : null,
    attendance: overview.ok
      ? {
          marked: overview.data.attendanceMarked,
          presentOrLate: overview.data.attendancePresentOrLate,
        }
      : null,
    certificates: overview.ok
      ? {
          issued: overview.data.certificatesIssued,
          revoked: overview.data.certificatesRevoked,
        }
      : null,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-muted-foreground text-sm">
          Read-only reports with filters and CSV export.
        </p>
      </div>
      <ReportsOverview data={data} />
    </div>
  );
}
