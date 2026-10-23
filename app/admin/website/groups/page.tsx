import { redirect } from "next/navigation";
import { DisplayGroupsManager } from "@/components/admin/website/programs/display-groups-manager";
import { WebsiteAreaNav } from "@/components/admin/website/programs/website-area-nav";
import { WebsiteDraftCopyCleanup } from "@/components/admin/website/unsaved-changes";
import { getCurrentUserContext } from "@/lib/auth/session";
import { listDisplayGroups } from "@/lib/data/website-programs";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";

export const dynamic = "force-dynamic";

/** Phase 22B-2: Program display groups (create, rename, reorder, hide). */
export default async function WebsiteGroupsPage() {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const groups = await listDisplayGroups();

  return (
    <div className="flex flex-col gap-6">
      <WebsiteDraftCopyCleanup ownerId={user.authUserId} />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Website</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Display groups organise the public Programs catalogue, for example &quot;Data
          and AI&quot;. Changes here apply to the public website straight away and are
          recorded in the audit log.
        </p>
      </div>
      <WebsiteAreaNav current="groups" />
      {groups.ok ? (
        <DisplayGroupsManager groups={groups.data} />
      ) : (
        <p role="alert" className="text-destructive text-sm">
          {groups.error}
        </p>
      )}
    </div>
  );
}
