import { redirect } from "next/navigation";
import { IncompleteUploads } from "@/components/admin/website/media/incomplete-uploads";
import {
  MediaFilterNav,
  MediaLibrary,
  type MediaFilter,
} from "@/components/admin/website/media/media-library";
import { MediaUploader } from "@/components/admin/website/media/media-uploader";
import { WebsiteAreaNav } from "@/components/admin/website/programs/website-area-nav";
import { WebsiteDraftCopyCleanup } from "@/components/admin/website/unsaved-changes";
import { getCurrentUserContext } from "@/lib/auth/session";
import { listIncompleteUploads, listMediaAssets } from "@/lib/data/website-media";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";
import { isMediaStatus } from "@/lib/domain/website-media";

// Rendered on demand for the signed-in Admin only; proxy.ts also sends
// Cache-Control: private, no-store and X-Robots-Tag: noindex here.
export const dynamic = "force-dynamic";

/** Phase 22B-3: website media library (Admin and Super Admin). */
export default async function WebsiteMediaPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const { status } = await searchParams;
  const filter: MediaFilter = isMediaStatus(status) ? status : "all";
  const [assets, incomplete] = await Promise.all([
    listMediaAssets(filter),
    listIncompleteUploads(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <WebsiteDraftCopyCleanup ownerId={user.authUserId} />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Website</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Images for website pages and Programs. Every image is private until it is
          approved and used in published content. Changes are recorded in the audit log.
        </p>
      </div>
      <WebsiteAreaNav current="media" />
      <MediaUploader />
      <section aria-labelledby="media-library-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="media-library-heading" className="text-base font-semibold">
            Media library
          </h2>
          <MediaFilterNav current={filter} />
        </div>
        {assets.ok ? (
          <MediaLibrary assets={assets.data} filter={filter} />
        ) : (
          <p role="alert" className="text-destructive text-sm">
            {assets.error}
          </p>
        )}
      </section>
      {incomplete.ok ? (
        <IncompleteUploads
          available={incomplete.data.available}
          items={incomplete.data.items}
        />
      ) : (
        <p role="alert" className="text-destructive text-sm">
          {incomplete.error}
        </p>
      )}
    </div>
  );
}
