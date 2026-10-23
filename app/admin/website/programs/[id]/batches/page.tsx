import { notFound, redirect } from "next/navigation";
import { BatchPublications } from "@/components/admin/website/programs/batch-publications";
import { ProgramHeader } from "@/components/admin/website/programs/program-header";
import { WebsiteDraftCopyCleanup } from "@/components/admin/website/unsaved-changes";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  PROGRAM_WEBSITE_NOT_FOUND,
  getProgramWebsite,
  listProgramBatches,
} from "@/lib/data/website-programs";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";

export const dynamic = "force-dynamic";

/** Phase 22B-2: which of a Program's Batches appear on the website, and how. */
export default async function ProgramBatchesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const { id } = await params;
  const result = await getProgramWebsite(id);
  if (!result.ok) {
    if (result.error === PROGRAM_WEBSITE_NOT_FOUND) notFound();
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }
  const batches = await listProgramBatches(result.data.program.id);

  return (
    <div className="flex flex-col gap-6">
      <WebsiteDraftCopyCleanup ownerId={user.authUserId} />
      <ProgramHeader detail={result.data} section="batches" />
      <p className="text-muted-foreground max-w-3xl text-sm">
        Choose which Batches appear on this Program&apos;s public page. The website shows
        only the public label and whether registration is Open, Closed or Full. Only
        upcoming or active Batches can be published. Nothing here changes the Batch in the
        LMS.
      </p>
      {batches.ok ? (
        <BatchPublications documentId={result.data.document.id} batches={batches.data} />
      ) : (
        <p role="alert" className="text-destructive text-sm">
          {batches.error}
        </p>
      )}
    </div>
  );
}
