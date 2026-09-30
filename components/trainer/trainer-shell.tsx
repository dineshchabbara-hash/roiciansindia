import { LogoutButton } from "@/components/public/logout-button";
import { TrainerNav } from "@/components/trainer/trainer-nav";
import type { UserContext } from "@/lib/auth/session";

/**
 * The Trainer Portal shell (Phase 11) — replaces
 * components/public/portal-placeholder-shell.tsx for the /trainer route
 * group, same structure as components/student/student-shell.tsx (Phase 10).
 */
export function TrainerShell({
  user,
  children,
}: {
  user: UserContext;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-card border-b md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="border-b p-4">
          <p className="font-semibold">Trainer Portal</p>
          <p className="text-muted-foreground truncate text-xs">
            {user.displayName ?? user.email}
          </p>
        </div>
        <TrainerNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b px-4 py-3">
          <div className="hidden text-right text-sm sm:block">
            <p className="font-medium">{user.displayName ?? user.email}</p>
            <p className="text-muted-foreground text-xs">Trainer</p>
          </div>
          <LogoutButton />
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
