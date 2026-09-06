import { UpcomingClassesCard } from "@/components/admin/dashboard/upcoming-classes-card";
import { getUpcomingClassSessions } from "@/lib/data/dashboard";

export async function UpcomingClassesSection() {
  const result = await getUpcomingClassSessions(5);
  return result.ok ? (
    <UpcomingClassesCard data={result.data} />
  ) : (
    <UpcomingClassesCard error={result.error} />
  );
}
