import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PagePreview } from "@/components/admin/website/page-preview";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  WEBSITE_NOT_FOUND,
  getWebsitePage,
  getWebsiteRevision,
  isUuid,
} from "@/lib/data/website";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";
import { pageDisplayName } from "@/lib/domain/website-admin";

// Rendered on demand for the signed-in Admin only; never prebuilt or cached.
// proxy.ts also sends Cache-Control: private, no-store and X-Robots-Tag:
// noindex for this route (TI-6, decision B2).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Preview: not public",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Phase 22B-1 authenticated structured preview of the latest saved version,
 * or of one version from the history (?revision=). Admin and Super Admin
 * only (the /admin layout and this page both check), never public.
 */
export default async function WebsitePagePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ revision?: string }>;
}) {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const { id } = await params;
  const { revision } = await searchParams;
  const page = await getWebsitePage(id);
  if (!page.ok) {
    if (page.error === WEBSITE_NOT_FOUND) notFound();
    return (
      <p role="alert" className="text-destructive text-sm">
        {page.error}
      </p>
    );
  }

  let content = page.data.latest;
  if (revision !== undefined) {
    if (!isUuid(revision)) notFound();
    const chosen = await getWebsiteRevision(page.data.id, revision);
    if (!chosen.ok) notFound();
    content = chosen.data;
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        role="note"
        className="rounded-md border-2 border-amber-400 bg-amber-50 p-3 text-sm font-medium text-amber-950 dark:bg-amber-950 dark:text-amber-100"
      >
        Preview: not public. Only signed-in Admins can see this page. It shows the content
        structure, not the final website design.
      </div>
      <div className="flex flex-col gap-1">
        <Link
          href={`/admin/website/pages/${page.data.id}`}
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          ← Back to the editor
        </Link>
        <h1 className="text-2xl font-semibold">Preview: {pageDisplayName(page.data)}</h1>
      </div>
      {content ? (
        <PagePreview
          content={content}
          isLive={content.id === page.data.publishedRevisionId}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          Nothing has been saved for this page yet.
        </p>
      )}
    </div>
  );
}
