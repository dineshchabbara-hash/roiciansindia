import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MediaDetail } from "@/components/admin/website/media/media-detail";
import { WebsiteAreaNav } from "@/components/admin/website/programs/website-area-nav";
import { WebsiteDraftCopyCleanup } from "@/components/admin/website/unsaved-changes";
import { getCurrentUserContext } from "@/lib/auth/session";
import { MEDIA_NOT_FOUND, getMediaAsset } from "@/lib/data/website-media";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Image details",
  robots: { index: false, follow: false, nocache: true },
};

/** Phase 22B-3: one image's details, alt text, approval and usage. */
export default async function WebsiteMediaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const { id } = await params;
  const result = await getMediaAsset(id);
  if (!result.ok) {
    if (result.error === MEDIA_NOT_FOUND) notFound();
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }
  const { asset, usage } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <WebsiteDraftCopyCleanup ownerId={user.authUserId} />
      <div className="flex flex-col gap-1">
        <Link
          href="/admin/website/media"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          ← Media library
        </Link>
        <h1 className="text-2xl font-semibold break-all">Image: {asset.fileName}</h1>
      </div>
      <WebsiteAreaNav current="media" />
      <MediaDetail asset={asset} usage={usage} />
    </div>
  );
}
