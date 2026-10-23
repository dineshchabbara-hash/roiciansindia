import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PagePreview } from "@/components/admin/website/page-preview";
import { getMediaOptions } from "@/lib/data/website-media";
import { contentImageIds } from "@/lib/domain/website-media";
import { ProgramHeader } from "@/components/admin/website/programs/program-header";
import { WebsiteDraftCopyCleanup } from "@/components/admin/website/unsaved-changes";
import { getCurrentUserContext } from "@/lib/auth/session";
import { getWebsiteRevision, isUuid } from "@/lib/data/website";
import {
  PROGRAM_WEBSITE_NOT_FOUND,
  getProgramWebsite,
  listProgramBatches,
} from "@/lib/data/website-programs";
import { REGISTRATION_STATE_LABELS } from "@/lib/domain/website";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";

// Rendered on demand for the signed-in Admin only; proxy.ts also sends
// Cache-Control: private, no-store and X-Robots-Tag: noindex here.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Preview: not public",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Phase 22B-2 authenticated structured preview of a Program's latest saved
 * content, or of one version (?revision=). Admin and Super Admin only.
 */
export default async function ProgramPreviewPage({
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
  const result = await getProgramWebsite(id);
  if (!result.ok) {
    if (result.error === PROGRAM_WEBSITE_NOT_FOUND) notFound();
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }
  const { document } = result.data;
  const batches = await listProgramBatches(result.data.program.id);
  // Only what the public page would show: the published label and state.
  const published = batches.ok
    ? batches.data.flatMap((b) =>
        b.publication?.isPublished &&
        b.publication.publishedLabel &&
        b.publication.publishedState
          ? [
              {
                id: b.id,
                label: b.publication.publishedLabel,
                state: b.publication.publishedState,
              },
            ]
          : [],
      )
    : [];

  let content = result.data.latest;
  if (revision !== undefined) {
    if (!isUuid(revision)) notFound();
    const chosen = await getWebsiteRevision(document.id, revision, "program");
    if (!chosen.ok) notFound();
    content = chosen.data;
  }

  // Phase 22B-3: the chosen images, through short-lived private links.
  const media = content ? await getMediaOptions(contentImageIds(content)) : null;

  return (
    <div className="flex flex-col gap-6">
      <WebsiteDraftCopyCleanup ownerId={user.authUserId} />
      <div
        role="note"
        className="rounded-md border-2 border-amber-400 bg-amber-50 p-3 text-sm font-medium text-amber-950 dark:bg-amber-950 dark:text-amber-100"
      >
        Preview: not public. Only signed-in Admins can see this page. It shows the content
        structure, not the final website design.
      </div>
      <ProgramHeader detail={result.data} section="preview" />
      {content ? (
        <PagePreview
          content={content}
          isLive={content.id === document.publishedRevisionId}
          media={media?.ok ? media.data : undefined}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          Nothing has been saved for this Program yet.
        </p>
      )}
      <section
        aria-labelledby="preview-batches"
        className="flex flex-col gap-2 rounded-md border p-4"
      >
        <h2 id="preview-batches" className="text-base font-semibold">
          Batches on the website
        </h2>
        <p className="text-muted-foreground text-xs">
          Published labels and registration states only. Which Batches the public page
          lists (for example, whether active Batches appear) is decided with the public
          website (TI-3).
        </p>
        {published.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No Batch is published, so the public page would show &quot;Next Cohort: Coming
            Soon&quot; with a way to join the interest list.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {published.map((b) => (
              <li key={b.id}>
                {b.label} · Registration {REGISTRATION_STATE_LABELS[b.state]}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
