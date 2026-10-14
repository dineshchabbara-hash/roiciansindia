import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateAdminForm } from "@/components/admin/accounts/create-admin-form";
import { AdminStatusButton } from "@/components/admin/accounts/admin-status-button";
import { AccessBadge } from "@/components/admin/accounts/access-badge";
import { getCurrentUserContext } from "@/lib/auth/session";
import { listAdminAccounts } from "@/lib/data/accounts";
import { isSuperAdmin, roleHomePath } from "@/lib/domain/rbac";

export const dynamic = "force-dynamic";

/**
 * Phase 21C — Admin accounts (role matrix: "Manage Admin accounts
 * (create/deactivate)" — Super Admin only). Anyone else is sent away
 * before anything is read. Super Admin accounts are listed but not
 * manageable here, and nobody can change their own account.
 */
export default async function AdminAccountsPage() {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isSuperAdmin(user.role)) {
    redirect(user.role === "admin" ? "/admin" : roleHomePath(user.role));
  }

  const result = await listAdminAccounts();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Admin Accounts</h1>
        <p className="text-muted-foreground text-sm">
          Create Admin logins and deactivate or reactivate them. Super Admin accounts are
          managed outside the application.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2 className="text-base">New admin</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CreateAdminForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2 className="text-base">Accounts</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!result.ok ? (
            <p role="alert" className="text-destructive text-sm">
              {result.error}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Admin accounts">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-2 pr-4 font-medium">Name</th>
                    <th className="py-2 pr-4 font-medium">Email</th>
                    <th className="py-2 pr-4 font-medium">Role</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Login</th>
                    <th className="py-2 pr-4 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((account) => {
                    const name = `${account.firstName} ${account.lastName}`.trim();
                    const manageable =
                      account.roleLevel === "admin" && account.id !== user.profileId;
                    return (
                      <tr key={account.id} className="border-b align-top last:border-0">
                        <td className="py-2 pr-4">{name}</td>
                        <td className="py-2 pr-4 break-all">{account.email}</td>
                        <td className="py-2 pr-4">
                          {account.roleLevel === "super_admin" ? "Super Admin" : "Admin"}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge
                            variant={
                              account.status === "active" ? "success" : "destructive"
                            }
                          >
                            {account.status === "active" ? "Active" : "Deactivated"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4">
                          <AccessBadge access={account.access} />
                        </td>
                        <td className="py-2 pr-4">
                          {manageable ? (
                            <AdminStatusButton
                              adminId={account.id}
                              name={name}
                              status={account.status}
                            />
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
