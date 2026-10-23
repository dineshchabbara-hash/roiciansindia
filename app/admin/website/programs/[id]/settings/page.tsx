import { notFound, redirect } from "next/navigation";
import { ProgramHeader } from "@/components/admin/website/programs/program-header";
import {
  ProgramPlacementForm,
  ProgramSlugForm,
} from "@/components/admin/website/programs/program-settings-forms";
import { WebsiteDraftCopyCleanup } from "@/components/admin/website/unsaved-changes";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  PROGRAM_WEBSITE_NOT_FOUND,
  getProgramWebsite,
  listDisplayGroups,
} from "@/lib/data/website-programs";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";
import { isProgramSlugLocked } from "@/lib/domain/website-programs";

export const dynamic = "force-dynamic";

/** Phase 22B-2: a Program's web address and catalogue placement. */
export default async function ProgramSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const { id } = await params;
  const [result, groups] = await Promise.all([
    getProgramWebsite(id),
    listDisplayGroups(),
  ]);
  if (!result.ok) {
    if (result.error === PROGRAM_WEBSITE_NOT_FOUND) notFound();
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }
  const { program, document } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <WebsiteDraftCopyCleanup ownerId={user.authUserId} />
      <ProgramHeader detail={result.data} section="settings" />
      <ProgramSlugForm
        documentId={document.id}
        slug={document.slug}
        version={document.version}
        locked={isProgramSlugLocked(document.firstPublishedAt)}
      />
      {groups.ok ? (
        <ProgramPlacementForm
          documentId={document.id}
          programName={program.name}
          version={document.version}
          groups={groups.data.map((g) => ({
            id: g.id,
            name: g.name,
            isVisible: g.isVisible,
          }))}
          placement={document.placement}
        />
      ) : (
        <p role="alert" className="text-destructive text-sm">
          {groups.error}
        </p>
      )}
    </div>
  );
}
