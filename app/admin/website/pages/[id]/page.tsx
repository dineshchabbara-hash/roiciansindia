import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageEditor, type EditorPage } from "@/components/admin/website/page-editor";
import { getEditorMedia } from "@/lib/data/website-media";
import { getCurrentUserContext } from "@/lib/auth/session";
import { WEBSITE_NOT_FOUND, getWebsitePage } from "@/lib/data/website";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";
import { pageDisplayName } from "@/lib/domain/website-admin";

export const dynamic = "force-dynamic";

/** Phase 22B-1 structured editor for one website page (Admin and Super Admin). */
export default async function WebsitePageEditorPage({
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
  const result = await getWebsitePage(id);
  if (!result.ok) {
    if (result.error === WEBSITE_NOT_FOUND) notFound();
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }
  const page = result.data;
  const restoredNumber = restored && /^\d{1,9}$/.test(restored) ? Number(restored) : null;

  const editorPage: EditorPage = {
    id: page.id,
    kind: page.kind,
    pageKey: page.pageKey,
    label: pageDisplayName(page),
    latestRevisionId: page.latestRevisionId,
    latestRevisionNumber: page.latestRevisionNumber,
    publishedRevisionId: page.publishedRevisionId,
    publishedRevisionNumber: page.publishedRevisionNumber,
    firstPublishedAt: page.firstPublishedAt,
    version: page.version,
  };

  // Phase 22B-3: image choices (null keeps images unchanged, as before).
  const media = await getEditorMedia(page.latest);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/admin/website"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          ← All website pages
        </Link>
        <h1 className="text-2xl font-semibold">{editorPage.label}</h1>
        <p className="text-muted-foreground text-sm">
          Page key: {page.pageKey}. Edit the structured content below, save a draft, then
          preview and publish when it is ready.
        </p>
      </div>

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
        key={`${page.id}:${restoredNumber ?? ""}`}
        page={editorPage}
        content={page.latest}
        media={media ?? undefined}
        stashOwnerId={user.authUserId}
      />
    </div>
  );
}
