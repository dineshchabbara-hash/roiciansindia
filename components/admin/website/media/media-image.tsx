import { ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MEDIA_STATUS_LABELS, type MediaStatus } from "@/lib/domain/website-media";
import { cn } from "@/lib/utils";

const STATUS_VARIANTS: Record<MediaStatus, "warning" | "success" | "secondary"> = {
  draft: "warning",
  approved: "success",
  retired: "secondary",
};

export function MediaStatusBadge({ status }: { status: MediaStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{MEDIA_STATUS_LABELS[status]}</Badge>;
}

/**
 * A private website image for Admin screens. The link is a short-lived signed
 * link made with the Admin's own session. A plain <img> is used on purpose:
 * the Next.js image optimizer would keep copies of private images in its
 * cache. No referrer is sent with the request.
 */
export function MediaImage({
  src,
  alt,
  className,
  fit = "cover",
}: {
  src: string | null;
  alt: string;
  className?: string;
  fit?: "cover" | "contain";
}) {
  if (!src) {
    return (
      <div
        className={cn(
          "bg-muted text-muted-foreground flex items-center justify-center",
          className,
        )}
      >
        <ImageOff aria-hidden className="size-6" />
        <span className="sr-only">Preview not available</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- private signed link; see above
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      className={cn(
        "bg-muted",
        fit === "cover" ? "object-cover" : "object-contain",
        className,
      )}
    />
  );
}
