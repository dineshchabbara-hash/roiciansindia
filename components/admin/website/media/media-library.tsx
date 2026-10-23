import Link from "next/link";
import type { MediaAsset } from "@/lib/data/website-media";
import {
  MEDIA_STATUS_LABELS,
  MEDIA_TYPE_LABELS,
  formatBytes,
  type MediaStatus,
} from "@/lib/domain/website-media";
import { MediaImage, MediaStatusBadge } from "./media-image";

export type MediaFilter = MediaStatus | "all";

const FILTERS: MediaFilter[] = ["all", "draft", "approved", "retired"];

/** Status filter links for the media library. */
export function MediaFilterNav({ current }: { current: MediaFilter }) {
  return (
    <nav aria-label="Filter images by status">
      <ul className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((filter) => {
          const active = filter === current;
          return (
            <li key={filter}>
              <Link
                href={
                  filter === "all"
                    ? "/admin/website/media"
                    : `/admin/website/media?status=${filter}`
                }
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "bg-primary text-primary-foreground rounded-full px-3 py-1 font-medium"
                    : "hover:bg-muted rounded-full border px-3 py-1"
                }
              >
                {filter === "all" ? "All" : MEDIA_STATUS_LABELS[filter]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Phase 22B-3 media library grid: thumbnail, status, alt text and file details. */
export function MediaLibrary({
  assets,
  filter,
}: {
  assets: MediaAsset[];
  filter: MediaFilter;
}) {
  if (assets.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {filter === "all"
          ? "No images yet. Upload the first one above."
          : `No ${MEDIA_STATUS_LABELS[filter]} images.`}
      </p>
    );
  }
  return (
    <ul
      aria-label="Images"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {assets.map((asset) => (
        <li key={asset.id} className="flex flex-col overflow-hidden rounded-md border">
          <MediaImage
            src={asset.previewUrl}
            alt={asset.altText ?? ""}
            className="aspect-video w-full"
          />
          <div className="flex flex-1 flex-col gap-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium" title={asset.fileName}>
                {asset.fileName}
              </p>
              <MediaStatusBadge status={asset.status} />
            </div>
            <p className="text-sm">
              {asset.altText ?? (
                <span className="text-amber-800 dark:text-amber-300">
                  No alt text yet
                </span>
              )}
            </p>
            <p className="text-muted-foreground text-xs">
              {MEDIA_TYPE_LABELS[asset.mimeType]}
              {asset.width && asset.height
                ? ` · ${asset.width} × ${asset.height} px`
                : ""}{" "}
              · {formatBytes(asset.byteSize)}
            </p>
            <Link
              href={`/admin/website/media/${asset.id}`}
              aria-label={`Details for ${asset.fileName}`}
              className="text-primary mt-auto text-sm underline-offset-4 hover:underline"
            >
              Details and approval
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
