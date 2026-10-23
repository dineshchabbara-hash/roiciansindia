import { notFound, redirect } from "next/navigation";
import { ProgramHeader } from "@/components/admin/website/programs/program-header";
import { RevisionHistory } from "@/components/admin/website/revision-history";
import { WebsiteDraftCopyCleanup } from "@/components/admin/website/unsaved-changes";
import { getCurrentUserContext } from "@/lib/auth/session";
import { restoreProgramRevisionAction } from "@/lib/actions/website-programs";
import { listWebsiteRevisions } from "@/lib/data/website";
import {
  PROGRAM_WEBSITE_NOT_FOUND,
  getProgramWebsite,
} from "@/lib/data/website-programs";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";

export const dynamic = "force-dynamic";

/** Phase 22B-2: a Program's content versions and safe restore. */
export default async function ProgramHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const { id } = await params;
  const [result, revisions] = await Promise.all([
    getProgramWebsite(id),
    listWebsiteRevisions(id, "program"),
  ]);
  if (!result.ok) {
    if (result.error === PROGRAM_WEBSITE_NOT_FOUND) notFound();
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }
  const { document } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <WebsiteDraftCopyCleanup ownerId={user.authUserId} />
      <ProgramHeader detail={result.data} section="history" />
      <p className="text-muted-foreground max-w-3xl text-sm">
        Every saved version is kept. Restoring copies an older version into a new draft;
        nothing is overwritten and the live page only changes when you publish.
      </p>
      {revisions.ok ? (
        <RevisionHistory
          documentId={document.id}
          revisions={revisions.data}
          latestRevisionNumber={document.latestRevisionNumber}
          restoreAction={restoreProgramRevisionAction}
          basePath={`/admin/website/programs/${document.id}`}
        />
      ) : (
        <p role="alert" className="text-destructive text-sm">
          {revisions.error}
        </p>
      )}
    </div>
  );
}
