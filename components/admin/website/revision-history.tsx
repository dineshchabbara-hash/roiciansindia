"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  restoreWebsiteRevisionAction,
  type WebsiteActionState,
} from "@/lib/actions/website";
import type { WebsiteFormAction } from "@/components/admin/website/page-editor";
import type { WebsiteRevisionSummary } from "@/lib/data/website";
import { formatWebsiteTimestamp } from "@/lib/domain/website-admin";

const initialState: WebsiteActionState = {};

function RestoreForm({
  documentId,
  revision,
  baseRevisionNumber,
  restoreAction,
}: {
  documentId: string;
  revision: WebsiteRevisionSummary;
  baseRevisionNumber: number;
  restoreAction: WebsiteFormAction;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, isPending] = useActionState(restoreAction, initialState);

  if (!confirming) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setConfirming(true)}
          aria-label={`Restore version ${revision.number}`}
        >
          Restore…
        </Button>
        {state.error && (
          <p role="alert" className="text-destructive text-xs">
            {state.error}
          </p>
        )}
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="sourceRevisionId" value={revision.id} />
      <input type="hidden" name="baseRevisionNumber" value={String(baseRevisionNumber)} />
      <p className="text-xs">
        Copy version {revision.number} into a new draft? The live page does not change
        until you publish.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Restoring…" : "Confirm restore"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Phase 22B-1 version history. Every saved version is kept. Restoring copies
 * an older version into a NEW draft version (never a silent overwrite), and
 * the database refuses it if someone saved after this list was loaded.
 */
export function RevisionHistory({
  documentId,
  revisions,
  latestRevisionNumber,
  restoreAction = restoreWebsiteRevisionAction,
  basePath = `/admin/website/pages/${documentId}`,
}: {
  documentId: string;
  revisions: WebsiteRevisionSummary[];
  latestRevisionNumber: number;
  /** Defaults to the 22B-1 page action; Programs pass their own. */
  restoreAction?: WebsiteFormAction;
  /** The document's editor path (the preview link is below it). */
  basePath?: string;
}) {
  if (revisions.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No versions have been saved yet.</p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">Saved versions, newest first</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Version
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Title
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Saved
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {revisions.map((revision) => (
            <tr key={revision.id} className="border-t align-top">
              <th scope="row" className="px-3 py-3 text-left font-medium">
                <div className="flex flex-col items-start gap-1">
                  <span>Version {revision.number}</span>
                  {revision.isPublished && <Badge variant="success">Live</Badge>}
                  {revision.isLatest && <Badge variant="secondary">Latest draft</Badge>}
                  {revision.restoredFromNumber !== null && (
                    <span className="text-muted-foreground text-xs font-normal">
                      Restored from version {revision.restoredFromNumber}
                    </span>
                  )}
                </div>
              </th>
              <td className="px-3 py-3">{revision.title}</td>
              <td className="px-3 py-3">
                <span className="flex flex-col">
                  <span>{formatWebsiteTimestamp(revision.createdAt)}</span>
                  <span className="text-muted-foreground text-xs">
                    {revision.createdByName ?? "an admin"}
                  </span>
                </span>
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-col items-start gap-2">
                  <Link
                    href={`${basePath}/preview?revision=${revision.id}`}
                    target="_blank"
                    rel="noopener"
                    className="text-primary text-sm underline-offset-4 hover:underline"
                  >
                    Preview
                  </Link>
                  {!revision.isLatest && (
                    <RestoreForm
                      documentId={documentId}
                      revision={revision}
                      baseRevisionNumber={latestRevisionNumber}
                      restoreAction={restoreAction}
                    />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
