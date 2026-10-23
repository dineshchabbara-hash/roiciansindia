import { redirect } from "next/navigation";
import { ProgramWebsiteList } from "@/components/admin/website/programs/program-website-list";
import { WebsiteAreaNav } from "@/components/admin/website/programs/website-area-nav";
import { WebsiteDraftCopyCleanup } from "@/components/admin/website/unsaved-changes";
import { getCurrentUserContext } from "@/lib/auth/session";
import { listProgramWebsiteEntries } from "@/lib/data/website-programs";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";

export const dynamic = "force-dynamic";

/**
 * Phase 22B-2: Programs on the website (Admin and Super Admin). Lists every
 * LMS Program with its separate website content. Nothing is copied from the
 * LMS Program and nothing is public until an Admin publishes it.
 */
export default async function WebsiteProgramsPage() {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const result = await listProgramWebsiteEntries();

  return (
    <div className="flex flex-col gap-6">
      <WebsiteDraftCopyCleanup ownerId={user.authUserId} />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Website</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Each Program&apos;s public page is written here, separately from its LMS record.
          The public website never shows prices or internal Program and Batch details.
        </p>
      </div>
      <WebsiteAreaNav current="programs" />
      {result.ok ? (
        <ProgramWebsiteList entries={result.data} />
      ) : (
        <p role="alert" className="text-destructive text-sm">
          {result.error}
        </p>
      )}
    </div>
  );
}
