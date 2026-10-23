"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  changeMediaStatusAction,
  saveMediaAltTextAction,
  type MediaActionState,
} from "@/lib/actions/website-media";
import type { MediaAsset, MediaUsage } from "@/lib/data/website-media";
import { formatWebsiteTimestamp } from "@/lib/domain/website-admin";
import {
  ALT_TEXT_MAX,
  MEDIA_STATUS_CHANGES,
  MEDIA_TYPE_LABELS,
  altTextProblem,
  availableStatusChanges,
  formatBytes,
  type MediaStatusChange,
} from "@/lib/domain/website-media";
import { MediaImage, MediaStatusBadge } from "./media-image";

const initialState: MediaActionState = {};

function Feedback({ state }: { state: MediaActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="text-sm text-green-800 dark:text-green-300">
        {state.message}
      </p>
    );
  }
  return null;
}

function AltTextForm({ asset }: { asset: MediaAsset }) {
  const id = useId();
  const [value, setValue] = useState(asset.altText ?? "");
  const [state, action, isPending] = useActionState(saveMediaAltTextAction, initialState);
  const expectedVersion = Math.max(asset.version, state.version ?? 0);
  const fieldError = state.fieldErrors?.altText?.[0];
  return (
    <form action={action} className="flex flex-col gap-2" aria-label="Edit alt text">
      <input type="hidden" name="assetId" value={asset.id} />
      <input type="hidden" name="expectedVersion" value={String(expectedVersion)} />
      <Label htmlFor={`${id}-alt`}>Alt text</Label>
      <textarea
        id={`${id}-alt`}
        className="border-input bg-background focus-visible:ring-ring aria-invalid:border-destructive min-h-20 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        name="altText"
        value={value}
        maxLength={ALT_TEXT_MAX}
        rows={3}
        aria-invalid={fieldError ? true : undefined}
        aria-describedby={`${id}-alt-help`}
        onChange={(e) => setValue(e.target.value)}
      />
      <p id={`${id}-alt-help`} className="text-muted-foreground text-xs">
        Describe what the image shows for people who cannot see it ({value.trim().length}/
        {ALT_TEXT_MAX}). Do not repeat the file name or include prices.
      </p>
      {fieldError && <p className="text-destructive text-xs">{fieldError}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save alt text"}
        </Button>
        {!fieldError && <Feedback state={state} />}
      </div>
    </form>
  );
}

const CONFIRM_TEXT: Record<MediaStatusChange, string> = {
  approve: "Approve this image? It can then be chosen for website pages and Programs.",
  withdraw:
    "Withdraw approval? The image becomes a Draft and cannot be chosen until approved again.",
  retire:
    "Retire this image? It can no longer be chosen for new content. Earlier versions keep their history.",
  restore: "",
};

function StatusPanel({ asset, usedByLive }: { asset: MediaAsset; usedByLive: boolean }) {
  const [confirming, setConfirming] = useState<MediaStatusChange | null>(null);
  const [state, action, isPending] = useActionState(
    async (prev: MediaActionState, formData: FormData) => {
      const result = await changeMediaStatusAction(prev, formData);
      setConfirming(null);
      return result;
    },
    initialState,
  );
  const altProblem = altTextProblem(asset.altText);
  const reasonFor = (change: MediaStatusChange): string | null => {
    if (change === "approve" && altProblem) return `Before approving: ${altProblem}`;
    if ((change === "withdraw" || change === "retire") && usedByLive) {
      return "Published content uses this image. Publish a version without it first.";
    }
    return null;
  };
  const changes = availableStatusChanges(asset.status);

  return (
    <section aria-labelledby="media-status-heading" className="flex flex-col gap-3">
      <h2 id="media-status-heading" className="text-base font-semibold">
        Approval
      </h2>
      <p className="flex items-center gap-2 text-sm">
        Status: <MediaStatusBadge status={asset.status} />
      </p>
      <p className="text-muted-foreground text-xs">
        Only Approved images can be chosen for content and published. Alt text is required
        before approval.
      </p>
      <div className="flex flex-wrap gap-2">
        {changes.map((change) => {
          const rule = MEDIA_STATUS_CHANGES[change];
          const reason = reasonFor(change);
          if (!rule.confirm) {
            return (
              <form key={change} action={action}>
                <input type="hidden" name="assetId" value={asset.id} />
                <input
                  type="hidden"
                  name="expectedVersion"
                  value={String(asset.version)}
                />
                <input type="hidden" name="change" value={change} />
                <Button type="submit" size="sm" variant="outline" disabled={isPending}>
                  {rule.label}
                </Button>
              </form>
            );
          }
          return (
            <Button
              key={change}
              type="button"
              size="sm"
              variant={change === "approve" ? "default" : "outline"}
              disabled={isPending || reason !== null}
              aria-describedby={reason ? `media-reason-${change}` : undefined}
              onClick={() => setConfirming(change)}
            >
              {rule.label}…
            </Button>
          );
        })}
      </div>
      {changes.map((change) => {
        const reason = reasonFor(change);
        return reason ? (
          <p
            key={change}
            id={`media-reason-${change}`}
            className="text-muted-foreground text-xs"
          >
            {reason}
          </p>
        ) : null;
      })}
      {confirming && (
        <form action={action} className="flex flex-col gap-2 rounded-md border p-3">
          <input type="hidden" name="assetId" value={asset.id} />
          <input type="hidden" name="expectedVersion" value={String(asset.version)} />
          <input type="hidden" name="change" value={confirming} />
          <p className="text-sm">{CONFIRM_TEXT[confirming]}</p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending
                ? "Saving…"
                : `Confirm: ${MEDIA_STATUS_CHANGES[confirming].label.toLowerCase()}`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      <Feedback state={state} />
    </section>
  );
}

function Usage({ usage }: { usage: MediaUsage[] }) {
  return (
    <section aria-labelledby="media-usage-heading" className="flex flex-col gap-2">
      <h2 id="media-usage-heading" className="text-base font-semibold">
        Where it is used
      </h2>
      {usage.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Not used in any page or Program yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {usage.map((u) => (
            <li key={u.documentId} className="flex flex-wrap items-center gap-2">
              <Link
                href={u.href}
                className="text-primary underline-offset-4 hover:underline"
              >
                {u.label}
              </Link>
              {u.inPublished && <Badge variant="success">Live</Badge>}
              {u.inLatest && <Badge variant="outline">Latest draft</Badge>}
              <span className="text-muted-foreground text-xs">
                {u.versionNumbers.length === 1 ? "Version" : "Versions"}{" "}
                {u.versionNumbers.join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Phase 22B-3 image details: preview, file details, alt text, approval and usage. */
export function MediaDetail({
  asset,
  usage,
}: {
  asset: MediaAsset;
  usage: MediaUsage[];
}) {
  const usedByLive = usage.some((u) => u.inPublished);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <MediaImage
          src={asset.previewUrl}
          alt={asset.altText ?? ""}
          fit="contain"
          className="max-h-[60vh] min-h-48 w-full rounded-md border"
        />
        <p className="text-muted-foreground text-xs">
          Private preview, shown only to signed-in Admins. The preview link expires after
          a few minutes; reload the page to see it again.
        </p>
        <AltTextForm key={`${asset.id}:${asset.version}`} asset={asset} />
        <Usage usage={usage} />
      </div>
      <aside className="flex flex-col gap-6">
        <StatusPanel asset={asset} usedByLive={usedByLive} />
        <section aria-labelledby="media-file-heading" className="flex flex-col gap-2">
          <h2 id="media-file-heading" className="text-base font-semibold">
            File
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="break-all">{asset.fileName}</dd>
            <dt className="text-muted-foreground">Type</dt>
            <dd>{MEDIA_TYPE_LABELS[asset.mimeType]}</dd>
            <dt className="text-muted-foreground">Size</dt>
            <dd>{formatBytes(asset.byteSize)}</dd>
            <dt className="text-muted-foreground">Dimensions</dt>
            <dd>
              {asset.width && asset.height ? `${asset.width} × ${asset.height} px` : "—"}
            </dd>
            <dt className="text-muted-foreground">Uploaded</dt>
            <dd>
              {formatWebsiteTimestamp(asset.createdAt)}
              {asset.createdByName ? ` by ${asset.createdByName}` : ""}
            </dd>
            <dt className="text-muted-foreground">Approved</dt>
            <dd>
              {asset.approvedAt
                ? `${formatWebsiteTimestamp(asset.approvedAt)}${asset.approvedByName ? ` by ${asset.approvedByName}` : ""}`
                : "Not approved"}
            </dd>
          </dl>
        </section>
      </aside>
    </div>
  );
}
