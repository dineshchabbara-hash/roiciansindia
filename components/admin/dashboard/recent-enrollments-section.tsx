import { RecentEnrollmentsCard } from "@/components/admin/dashboard/recent-enrollments-card";
import { getRecentEnrollments } from "@/lib/data/dashboard";

export async function RecentEnrollmentsSection() {
  const result = await getRecentEnrollments(5);
  return result.ok ? (
    <RecentEnrollmentsCard data={result.data} />
  ) : (
    <RecentEnrollmentsCard error={result.error} />
  );
}
