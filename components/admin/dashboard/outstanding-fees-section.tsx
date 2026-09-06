import { OutstandingFeesCard } from "@/components/admin/dashboard/outstanding-fees-card";
import { getOutstandingFeesSummary } from "@/lib/data/dashboard";

export async function OutstandingFeesSection() {
  const result = await getOutstandingFeesSummary();
  return result.ok ? (
    <OutstandingFeesCard data={result.data} />
  ) : (
    <OutstandingFeesCard error={result.error} />
  );
}
