import {
  Users,
  GraduationCap,
  BookOpen,
  CalendarDays,
  ClipboardList,
  IndianRupee,
  Wallet,
  UserCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MetricCard } from "@/components/admin/dashboard/metric-card";
import { getDashboardMetrics } from "@/lib/data/dashboard";
import { formatPaiseAsINR } from "@/lib/domain/money";

export async function MetricsGridSection() {
  const result = await getDashboardMetrics();

  if (!result.ok) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p role="alert" className="text-destructive text-sm">
            {result.error}
          </p>
        </CardContent>
      </Card>
    );
  }

  const m = result.data;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <MetricCard label="Total Students" value={m.totalStudents} icon={Users} />
      <MetricCard label="Active Students" value={m.activeStudents} icon={UserCheck} />
      <MetricCard label="Total Trainers" value={m.totalTrainers} icon={GraduationCap} />
      <MetricCard label="Active Programs" value={m.activePrograms} icon={BookOpen} />
      <MetricCard label="Active Batches" value={m.activeBatches} icon={CalendarDays} />
      <MetricCard
        label="Active Enrollments"
        value={m.activeEnrollments}
        icon={ClipboardList}
      />
      <MetricCard
        label="Revenue Collected"
        value={formatPaiseAsINR(m.revenueCollectedPaise)}
        icon={IndianRupee}
      />
      <MetricCard
        label="Outstanding Fees"
        value={formatPaiseAsINR(m.outstandingFeesPaise)}
        icon={Wallet}
      />
    </div>
  );
}
