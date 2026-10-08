import { LogoutButton } from "@/components/public/logout-button";
import { StudentNav } from "@/components/student/student-nav";
import type { UserContext } from "@/lib/auth/session";

/**
 * The Student Portal shell (Phase 10) — replaces
 * components/public/portal-placeholder-shell.tsx for the /student route
 * group. Intentionally simpler than components/admin/admin-shell.tsx (no
 * separate mobile drawer/breadcrumb subsystem): the Student Portal has 3
 * nav items total, so a single responsive nav (horizontal on narrow
 * viewports, a left column from md up) covers it without that extra
 * machinery.
 */
export function StudentShell({
  user,
  unreadNotificationCount = 0,
  children,
}: {
  user: UserContext;
  unreadNotificationCount?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-card border-b md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="border-b p-4">
          <p className="font-semibold">Student Portal</p>
          <p className="text-muted-foreground truncate text-xs">
            {user.displayName ?? user.email}
          </p>
        </div>
        <StudentNav unreadNotificationCount={unreadNotificationCount} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b px-4 py-3">
          <div className="hidden text-right text-sm sm:block">
            <p className="font-medium">{user.displayName ?? user.email}</p>
            <p className="text-muted-foreground text-xs">Student</p>
          </div>
          <LogoutButton />
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
