import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { canAccessRouteGroup, roleHomePath } from "@/lib/domain/rbac";
import { TrainerShell } from "@/components/trainer/trainer-shell";
import { getUnreadNotificationCount } from "@/lib/data/notifications";

// See app/admin/layout.tsx for why this is forced dynamic.
export const dynamic = "force-dynamic";

export default async function TrainerLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserContext();

  if (!user) {
    redirect("/login/trainer");
  }
  if (!canAccessRouteGroup(user.role, "trainer")) {
    redirect(roleHomePath(user.role));
  }

  // A failed count must never break the portal shell; it just hides the badge.
  const unread = await getUnreadNotificationCount(user.authUserId);

  return (
    <TrainerShell user={user} unreadNotificationCount={unread.ok ? unread.data : 0}>
      {children}
    </TrainerShell>
  );
}
