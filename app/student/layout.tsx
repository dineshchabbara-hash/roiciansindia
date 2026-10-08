import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { canAccessRouteGroup, roleHomePath } from "@/lib/domain/rbac";
import { StudentShell } from "@/components/student/student-shell";
import { getUnreadNotificationCount } from "@/lib/data/notifications";

// See app/admin/layout.tsx for why this is forced dynamic.
export const dynamic = "force-dynamic";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserContext();

  if (!user) {
    redirect("/login/student");
  }
  if (!canAccessRouteGroup(user.role, "student")) {
    redirect(roleHomePath(user.role));
  }

  // A failed count must never break the portal shell; it just hides the badge.
  const unread = await getUnreadNotificationCount(user.authUserId);

  return (
    <StudentShell user={user} unreadNotificationCount={unread.ok ? unread.data : 0}>
      {children}
    </StudentShell>
  );
}
