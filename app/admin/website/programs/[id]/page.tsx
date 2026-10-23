import { notFound, redirect } from "next/navigation";
import { PageEditor, type EditorPage } from "@/components/admin/website/page-editor";
import { getEditorMedia } from "@/lib/data/website-media";
import { ProgramHeader } from "@/components/admin/website/programs/program-header";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  publishProgramAction,
  saveProgramDraftAction,
  unpublishProgramAction,
} from "@/lib/actions/website-programs";
import {
  PROGRAM_WEBSITE_NOT_FOUND,
  getProgramWebsite,
} from "@/lib/data/website-programs";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";
import {
  PROGRAM_NOT_ACTIVE_MESSAGE,
  programCanBePublished,
} from "@/lib/domain/website-programs";

export const dynamic = "force-dynamic";

/**
 * Phase 22B-2 structured editor for one Program's public content (Admin and
 * Super Admin). Reuses the 22B-1 editor with the Program actions: drafts,
 * stale-edit protection, unsaved-change warnings and confirmed publishing.
 */
export default async function ProgramContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ restored?: string }>;
}) {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const { id } = await params;
  const { restored } = await searchParams;
  const result = await getProgramWebsite(id);
  if (!result.ok) {
    if (result.error === PROGRAM_WEBSITE_NOT_FOUND) notFound();
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }
  const { program, document, latest } = result.data;
  const restoredNumber = restored && /^\d{1,9}$/.test(restored) ? Number(restored) : null;

  const editorPage: EditorPage = {
    id: document.id,
    kind: "program",
    pageKey: `program-${program.id}`,
    label: program.name,
    latestRevisionId: document.latestRevisionId,
    latestRevisionNumber: document.latestRevisionNumber,
    publishedRevisionId: document.publishedRevisionId,
    publishedRevisionNumber: document.publishedRevisionNumber,
    firstPublishedAt: document.firstPublishedAt,
    version: document.version,
  };

  // Phase 22B-3: image choices (null keeps images unchanged, as before).
  const media = await getEditorMedia(latest);

  return (
    <div className="flex flex-col gap-6">
      <ProgramHeader detail={result.data} section="content" />
      <p className="text-muted-foreground max-w-3xl text-sm">
        Write the Program&apos;s public page here. Nothing is copied from the LMS record:
        the headline, summary and sections are written for the website. Do not include
        prices, internal notes or Batch logistics.
      </p>

      {restoredNumber !== null && (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
        >
          An earlier version was restored as new draft version {restoredNumber}. Review
          it, then publish when ready. Nothing changed on the live page.
        </p>
      )}

      <PageEditor
        key={`${document.id}:${restoredNumber ?? ""}`}
        page={editorPage}
        content={latest}
        media={media ?? undefined}
        stashOwnerId={user.authUserId}
        bindings={{
          save: saveProgramDraftAction,
          publish: publishProgramAction,
          unpublish: unpublishProgramAction,
          basePath: `/admin/website/programs/${document.id}`,
          publishHeldReason: programCanBePublished(program.status)
            ? null
            : PROGRAM_NOT_ACTIVE_MESSAGE,
          subject: "Program",
        }}
      />
    </div>
  );
}
