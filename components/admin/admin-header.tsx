import { MobileNav } from "@/components/admin/mobile-nav";
import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";
import { LogoutButton } from "@/components/public/logout-button";
import type { UserContext } from "@/lib/auth/session";

export function AdminHeader({
  companyName,
  user,
}: {
  companyName: string;
  user: UserContext;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <MobileNav companyName={companyName} />
        <AdminBreadcrumb />
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden text-right text-sm sm:block">
          <p className="font-medium">{user.displayName ?? user.email}</p>
          <p className="text-muted-foreground text-xs capitalize">
            {user.role.replace("_", " ")}
          </p>
        </div>
        <LogoutButton />
      </div>
    </header>
  );
}
