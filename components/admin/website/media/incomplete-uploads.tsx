"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  removeIncompleteUploadsAction,
  type MediaActionState,
} from "@/lib/actions/website-media";
import type { IncompleteUpload } from "@/lib/data/website-media";
import { formatBytes, mediaFileName } from "@/lib/domain/website-media";
import { formatWebsiteTimestamp } from "@/lib/domain/website-admin";

const initialState: MediaActionState = {};

/**
 * Phase 22B-3: files that reached the bucket but were never recorded as
 * images (for example, the browser closed mid-upload). Listed after 24
 * hours; removal is confirmed first and never touches a recorded image.
 */
export function IncompleteUploads({
  available,
  items,
}: {
  available: boolean;
  items: IncompleteUpload[];
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, isPending] = useActionState(async (prev: MediaActionState) => {
    const result = await removeIncompleteUploadsAction();
    setConfirming(false);
    return result ?? prev;
  }, initialState);

  return (
    <section
      aria-labelledby="incomplete-uploads-heading"
      className="flex flex-col gap-2 rounded-md border p-4"
    >
      <h2 id="incomplete-uploads-heading" className="text-base font-semibold">
        Incomplete uploads
      </h2>
      {!available ? (
        <p className="text-muted-foreground text-sm">
          Clean-up becomes available once the website media upload policy is approved.
        </p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No incomplete uploads. Files that never finished uploading are listed here after
          24 hours.
        </p>
      ) : (
        <>
          <p className="text-sm">
            {items.length === 1
              ? "1 file reached storage but was never recorded as an image."
              : `${items.length} files reached storage but were never recorded as images.`}{" "}
            They are not shown anywhere. Removing them cannot affect recorded images.
          </p>
          <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
            {items.slice(0, 10).map((item) => (
              <li key={item.path}>
                {mediaFileName(item.path)} · {formatWebsiteTimestamp(item.uploadedAt)}
                {item.byteSize !== null ? ` · ${formatBytes(item.byteSize)}` : ""}
                {item.uploadedByMe ? " · uploaded by you" : ""}
              </li>
            ))}
            {items.length > 10 && <li>and {items.length - 10} more</li>}
          </ul>
          {confirming ? (
            <form action={action} className="flex flex-wrap items-center gap-2">
              <p className="text-sm">Remove these incomplete uploads?</p>
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Removing…" : "Confirm removal"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirming(true)}
              >
                Remove incomplete uploads…
              </Button>
            </div>
          )}
        </>
      )}
      {state.error && (
        <p role="alert" className="text-destructive text-xs">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-xs text-green-800 dark:text-green-300">
          {state.message}
        </p>
      )}
    </section>
  );
}
