import { LogoutButton } from "@/components/public/logout-button";
import type { UserContext } from "@/lib/auth/session";

/**
 * Deliberately bare: NOT the Admin/Trainer/Student dashboard (those are
 * later phases — see ARCHITECTURE.md §3, IMPLEMENTATION_PLAN.md Phases
 * 4/10/11). This exists only so Phase 3's login → role-based redirect →
 * route-group gate flow has a real page to land on and be tested against,
 * without building any sidebar/nav/dashboard-card UI ahead of its phase.
 */
export function PortalPlaceholderShell({
  portalName,
  user,
}: {
  portalName: string;
  user: UserContext;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b p-4">
        <div>
          <p className="text-sm font-medium">{portalName}</p>
          <p className="text-muted-foreground text-xs">
            Signed in as {user.displayName ?? user.email} ({user.role})
          </p>
        </div>
        <LogoutButton />
      </header>
      <main className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="text-muted-foreground max-w-md text-sm">
          Authentication and access control are working. The {portalName.toLowerCase()}{" "}
          itself is built in a later phase — see{" "}
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
            IMPLEMENTATION_PLAN.md
          </code>
          .
        </p>
      </main>
    </div>
  );
}
