import { RecentPaymentsCard } from "@/components/admin/dashboard/recent-payments-card";
import { getRecentPayments } from "@/lib/data/dashboard";

export async function RecentPaymentsSection() {
  const result = await getRecentPayments(5);
  return result.ok ? (
    <RecentPaymentsCard data={result.data} />
  ) : (
    <RecentPaymentsCard error={result.error} />
  );
}
