import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { MetricsGridSection } from "@/components/admin/dashboard/metrics-grid-section";
import { RecentEnrollmentsSection } from "@/components/admin/dashboard/recent-enrollments-section";
import { RecentPaymentsSection } from "@/components/admin/dashboard/recent-payments-section";
import { UpcomingClassesSection } from "@/components/admin/dashboard/upcoming-classes-section";
import { OutstandingFeesSection } from "@/components/admin/dashboard/outstanding-fees-section";
import { QuickActions } from "@/components/admin/dashboard/quick-actions";
import {
  MetricsGridSkeleton,
  ListCardSkeleton,
} from "@/components/admin/dashboard/card-skeleton";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  // The layout has already verified the session/role; this defensive check
  // (rather than a non-null assertion) is defense in depth, not a
  // duplicate of the layout's authorization.
  const user = await getCurrentUserContext();
  if (!user) {
    redirect("/login/admin");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Welcome back, {user.displayName ?? user.email}.
        </p>
      </div>

      {/* Each section streams in independently: a slow or failing query in
          one card never blocks or breaks the others. */}
      <Suspense fallback={<MetricsGridSkeleton />}>
        <MetricsGridSection />
      </Suspense>

      <Suspense fallback={<ListCardSkeleton title="outstanding fees" />}>
        <OutstandingFeesSection />
      </Suspense>

      <QuickActions />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Suspense fallback={<ListCardSkeleton title="recent enrollments" />}>
          <RecentEnrollmentsSection />
        </Suspense>
        <Suspense fallback={<ListCardSkeleton title="recent payments" />}>
          <RecentPaymentsSection />
        </Suspense>
        <Suspense fallback={<ListCardSkeleton title="upcoming classes" />}>
          <UpcomingClassesSection />
        </Suspense>
      </div>
    </div>
  );
}
