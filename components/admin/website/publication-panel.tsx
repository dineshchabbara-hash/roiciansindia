"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageStatusBadge } from "@/components/admin/website/page-status-badge";
import {
  publishWebsitePageAction,
  unpublishWebsitePageAction,
  type WebsiteActionState,
} from "@/lib/actions/website";
import {
  LEGAL_PUBLICATION_HELD_MESSAGE,
  isPublicationHeld,
  websitePageStatus,
} from "@/lib/domain/website-admin";
import type { EditorPage } from "@/components/admin/website/page-editor";

const initialState: WebsiteActionState = {};

/**
 * Publish and unpublish, each with an explicit confirmation step. Publishing
 * always names the latest saved version; the database refuses it if a newer
 * version was saved meanwhile. Legal pages cannot be published until their
 * wording is approved (C4). The button stays disabled with the reason shown,
 * and the server action refuses too.
 */
export function PublicationPanel({
  page,
  latestRevisionId,
  latestRevisionNumber,
  dirty,
}: {
  page: EditorPage;
  latestRevisionId: string | null;
  latestRevisionNumber: number;
  dirty: boolean;
}) {
  const [confirm, setConfirm] = useState<"publish" | "unpublish" | null>(null);
  // Only the most recent outcome is shown.
  const [feedback, setFeedback] = useState<WebsiteActionState | null>(null);
  const [, publishAction, isPublishing] = useActionState(
    async (prev: WebsiteActionState, formData: FormData) => {
      const result = await publishWebsitePageAction(prev, formData);
      setConfirm(null);
      setFeedback(result);
      return result;
    },
    initialState,
  );
  const [, unpublishAction, isUnpublishing] = useActionState(
    async (prev: WebsiteActionState, formData: FormData) => {
      const result = await unpublishWebsitePageAction(prev, formData);
      setConfirm(null);
      setFeedback(result);
      return result;
    },
    initialState,
  );

  const status = websitePageStatus({
    latestRevisionId,
    publishedRevisionId: page.publishedRevisionId,
    firstPublishedAt: page.firstPublishedAt,
  });
  const held = isPublicationHeld(page);
  const alreadyLive =
    latestRevisionId !== null && latestRevisionId === page.publishedRevisionId;

  let publishBlockedReason: string | null = null;
  if (held) publishBlockedReason = LEGAL_PUBLICATION_HELD_MESSAGE;
  else if (latestRevisionId === null)
    publishBlockedReason = "Save a draft before publishing.";
  else if (dirty) publishBlockedReason = "Save your changes before publishing.";
  else if (alreadyLive)
    publishBlockedReason = "The latest saved version is already live.";

  return (
    <div
      className="flex flex-col gap-3 rounded-md border p-4"
      aria-labelledby="publication-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="publication-heading" className="text-sm font-semibold">
          Publication
        </h2>
        <PageStatusBadge status={status} />
      </div>

      <p className="text-muted-foreground text-xs">
        {page.publishedRevisionNumber !== null && page.publishedRevisionId
          ? `Live version: ${page.publishedRevisionNumber}.`
          : "No version is live."}
      </p>

      {held && (
        <p
          id="publish-held-note"
          className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {LEGAL_PUBLICATION_HELD_MESSAGE}
        </p>
      )}

      {confirm === "publish" ? (
        <form action={publishAction} className="flex flex-col gap-2">
          <input type="hidden" name="documentId" value={page.id} />
          <input type="hidden" name="revisionId" value={latestRevisionId ?? ""} />
          <p className="text-sm">
            Publish version {latestRevisionNumber}? It becomes the live content for this
            page.
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPublishing}>
              {isPublishing ? "Publishing…" : "Confirm publish"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirm(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            disabled={publishBlockedReason !== null}
            aria-describedby={
              held
                ? "publish-held-note"
                : publishBlockedReason
                  ? "publish-blocked-reason"
                  : undefined
            }
            onClick={() => setConfirm("publish")}
          >
            Publish…
          </Button>
          {publishBlockedReason && !held ? (
            <p id="publish-blocked-reason" className="text-muted-foreground text-xs">
              {publishBlockedReason}
            </p>
          ) : null}
        </div>
      )}

      {page.publishedRevisionId &&
        (confirm === "unpublish" ? (
          <form action={unpublishAction} className="flex flex-col gap-2">
            <input type="hidden" name="documentId" value={page.id} />
            <input type="hidden" name="expectedVersion" value={String(page.version)} />
            <p className="text-sm">
              Unpublish this page? It will have no live content until a version is
              published again. Drafts and history are kept.
            </p>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                variant="destructive"
                disabled={isUnpublishing}
              >
                {isUnpublishing ? "Unpublishing…" : "Confirm unpublish"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="outline" onClick={() => setConfirm("unpublish")}>
            Unpublish…
          </Button>
        ))}

      {feedback?.error && (
        <p role="alert" className="text-destructive text-xs">
          {feedback.error}
        </p>
      )}
      {feedback?.message && (
        <p role="status" className="text-xs text-green-800 dark:text-green-300">
          {feedback.message}
        </p>
      )}

      <div className="flex flex-col gap-1 border-t pt-3 text-sm">
        <Link
          href={`/admin/website/pages/${page.id}/preview`}
          target="_blank"
          rel="noopener"
          className="text-primary underline-offset-4 hover:underline"
        >
          Preview latest saved version
        </Link>
        <Link
          href={`/admin/website/pages/${page.id}/history`}
          className="text-primary underline-offset-4 hover:underline"
        >
          Version history
        </Link>
      </div>
    </div>
  );
}
