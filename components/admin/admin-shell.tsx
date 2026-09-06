import { SidebarNav } from "@/components/admin/sidebar-nav";
import { AdminHeader } from "@/components/admin/admin-header";
import type { UserContext } from "@/lib/auth/session";

export function AdminShell({
  companyName,
  user,
  children,
}: {
  companyName: string;
  user: UserContext;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar — fixed, hidden below md. Mobile uses the drawer
          in AdminHeader (MobileNav) instead, sharing the same SidebarNav
          list so active-state logic is never duplicated. */}
      <aside className="bg-card hidden w-64 shrink-0 border-r md:block">
        <div className="border-b p-4">
          <p className="font-semibold">{companyName}</p>
          <p className="text-muted-foreground text-xs">Admin Portal</p>
        </div>
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminHeader companyName={companyName} user={user} />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
