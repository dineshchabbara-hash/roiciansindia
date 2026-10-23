import { redirect } from "next/navigation";
import { FeaturedProgramsManager } from "@/components/admin/website/programs/featured-programs-manager";
import { WebsiteAreaNav } from "@/components/admin/website/programs/website-area-nav";
import { WebsiteDraftCopyCleanup } from "@/components/admin/website/unsaved-changes";
import { getCurrentUserContext } from "@/lib/auth/session";
import { listProgramWebsiteEntries } from "@/lib/data/website-programs";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";
import { sortFeatured } from "@/lib/domain/website-programs";

export const dynamic = "force-dynamic";

/** Phase 22B-2: featured Programs and their order. */
export default async function WebsiteFeaturedPage() {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const entries = await listProgramWebsiteEntries();
  const featured = entries.ok
    ? sortFeatured(
        entries.data.flatMap(({ program, document }) =>
          document?.placement.isFeatured
            ? [
                {
                  documentId: document.id,
                  version: document.version,
                  programName: program.name,
                  name: document.title ?? program.name,
                  headline: document.title,
                  status: document.status,
                  featuredOrder: document.placement.featuredOrder,
                },
              ]
            : [],
        ),
      )
    : [];

  return (
    <div className="flex flex-col gap-6">
      <WebsiteDraftCopyCleanup ownerId={user.authUserId} />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Website</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Featured Programs are highlighted on the homepage in this order. Only published
          Programs are shown publicly. Every change is confirmed first, applies straight
          away and is recorded in the audit log.
        </p>
      </div>
      <WebsiteAreaNav current="featured" />
      {entries.ok ? (
        <FeaturedProgramsManager programs={featured} />
      ) : (
        <p role="alert" className="text-destructive text-sm">
          {entries.error}
        </p>
      )}
    </div>
  );
}
