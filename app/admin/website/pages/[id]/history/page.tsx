import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RevisionHistory } from "@/components/admin/website/revision-history";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  WEBSITE_NOT_FOUND,
  getWebsitePage,
  listWebsiteRevisions,
} from "@/lib/data/website";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";
import { pageDisplayName } from "@/lib/domain/website-admin";

export const dynamic = "force-dynamic";

/** Phase 22B-1 version history and safe restore (Admin and Super Admin). */
export default async function WebsitePageHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const { id } = await params;
  const [page, revisions] = await Promise.all([
    getWebsitePage(id),
    listWebsiteRevisions(id),
  ]);
  if (!page.ok) {
    if (page.error === WEBSITE_NOT_FOUND) notFound();
    return (
      <p role="alert" className="text-destructive text-sm">
        {page.error}
      </p>
    );
  }
  const name = pageDisplayName(page.data);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/admin/website/pages/${page.data.id}`}
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          ← Back to the editor
        </Link>
        <h1 className="text-2xl font-semibold">Version history: {name}</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Every saved version is kept. Restoring copies an older version into a new draft;
          nothing is overwritten and the live page only changes when you publish.
        </p>
      </div>
      {revisions.ok ? (
        <RevisionHistory
          documentId={page.data.id}
          revisions={revisions.data}
          latestRevisionNumber={page.data.latestRevisionNumber}
        />
      ) : (
        <p role="alert" className="text-destructive text-sm">
          {revisions.error}
        </p>
      )}
    </div>
  );
}
