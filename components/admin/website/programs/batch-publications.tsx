"use client";

import { useActionState, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  publishBatchAction,
  saveBatchPublicationAction,
  unpublishBatchAction,
  type ProgramActionState,
} from "@/lib/actions/website-programs";
import type { ProgramBatch } from "@/lib/data/website-programs";
import {
  REGISTRATION_STATES,
  REGISTRATION_STATE_LABELS,
  WEBSITE_LIMITS,
} from "@/lib/domain/website";
import {
  BATCH_LABEL_HINT,
  BATCH_NOT_PUBLISHABLE_MESSAGE,
  BATCH_STATUS_BADGE_VARIANTS,
  BATCH_STATUS_LABELS,
  LMS_BATCH_STATUS_LABELS,
  batchCanBePublished,
  batchPublicationStatus,
} from "@/lib/domain/website-programs";
import type { WebsiteRegistrationState } from "@/lib/supabase/database.types";

const initialState: ProgramActionState = {};

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function Feedback({ state }: { state: ProgramActionState }) {
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

function BatchCard({ documentId, batch }: { documentId: string; batch: ProgramBatch }) {
  const id = useId();
  const pub = batch.publication;
  const [label, setLabel] = useState(pub?.draftLabel ?? "");
  const [registrationState, setRegistrationState] = useState<WebsiteRegistrationState>(
    pub?.draftState ?? "closed",
  );
  const [confirm, setConfirm] = useState<"publish" | "unpublish" | null>(null);
  const [outcome, setOutcome] = useState<ProgramActionState>(initialState);
  const [versionSeen, setVersionSeen] = useState(0);

  const wrap =
    (action: typeof saveBatchPublicationAction) =>
    async (prev: ProgramActionState, formData: FormData) => {
      const result = await action(prev, formData);
      setConfirm(null);
      setOutcome(result);
      if (result.version) setVersionSeen(result.version);
      return result;
    };
  const [, saveAction, isSaving] = useActionState(
    wrap(saveBatchPublicationAction),
    initialState,
  );
  const [, publishAction, isPublishing] = useActionState(
    wrap(publishBatchAction),
    initialState,
  );
  const [, unpublishAction, isUnpublishing] = useActionState(
    wrap(unpublishBatchAction),
    initialState,
  );

  // Versions only increase: take whichever is newer, the page's or ours.
  const expectedVersion = Math.max(pub?.version ?? 0, versionSeen);
  const status = batchPublicationStatus(pub);
  const unsaved =
    label.trim() !== (pub?.draftLabel ?? "") ||
    registrationState !== (pub?.draftState ?? "closed");
  const publishable = batchCanBePublished(batch.status);

  let publishBlocked: string | null = null;
  if (!publishable) publishBlocked = BATCH_NOT_PUBLISHABLE_MESSAGE;
  else if (!pub) publishBlocked = "Save a public label and registration state first.";
  else if (unsaved) publishBlocked = "Save your changes before publishing.";
  else if (!pub.draftLabel)
    publishBlocked = "A public label is required to publish a Batch.";
  else if (status === "published") publishBlocked = "These settings are already live.";

  const hidden = (
    <>
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="batchId" value={batch.id} />
      <input type="hidden" name="expectedVersion" value={String(expectedVersion)} />
    </>
  );

  return (
    <li className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">
            {batch.name}{" "}
            <span className="text-muted-foreground text-xs font-normal">
              (internal name, never shown publicly)
            </span>
          </p>
          <p className="text-muted-foreground text-xs">
            Starts {dateFormat.format(new Date(`${batch.startDate}T00:00:00Z`))} ·{" "}
            {LMS_BATCH_STATUS_LABELS[batch.status]} in the LMS
          </p>
        </div>
        <Badge variant={BATCH_STATUS_BADGE_VARIANTS[status]}>
          {BATCH_STATUS_LABELS[status]}
        </Badge>
      </div>

      {pub?.isPublished && (
        <p className="text-sm">
          On the website: <span className="font-medium">{pub.publishedLabel}</span> ·{" "}
          {pub.publishedState ? REGISTRATION_STATE_LABELS[pub.publishedState] : ""}
        </p>
      )}

      <form action={saveAction} className="flex flex-col gap-3">
        {hidden}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-label`}>Public label</Label>
            <Input
              id={`${id}-label`}
              name="publicLabel"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={WEBSITE_LIMITS.batchLabel}
              autoComplete="off"
              aria-describedby={`${id}-label-hint`}
              aria-invalid={outcome.fieldErrors?.publicLabel ? true : undefined}
            />
            <p id={`${id}-label-hint`} className="text-muted-foreground text-xs">
              {outcome.fieldErrors?.publicLabel?.[0] ?? BATCH_LABEL_HINT}
            </p>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">Registration</legend>
            <div className="flex gap-3">
              {REGISTRATION_STATES.map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="registrationState"
                    value={s}
                    checked={registrationState === s}
                    onChange={() => setRegistrationState(s)}
                  />
                  {REGISTRATION_STATE_LABELS[s]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={isSaving || !unsaved}
          >
            {isSaving ? "Saving…" : "Save website settings"}
          </Button>
        </div>
      </form>

      {confirm === "publish" ? (
        <form
          action={publishAction}
          className="flex flex-col gap-2 rounded-md border p-3"
        >
          {hidden}
          <p className="text-sm">
            Publish this Batch as &quot;{pub?.draftLabel}&quot; with registration{" "}
            {REGISTRATION_STATE_LABELS[pub?.draftState ?? "closed"]}? It appears on the
            Program&apos;s public page.
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
      ) : confirm === "unpublish" ? (
        <form
          action={unpublishAction}
          className="flex flex-col gap-2 rounded-md border p-3"
        >
          {hidden}
          <p className="text-sm">
            Remove this Batch from the website? Its website settings are kept, and the
            Batch itself is not changed in the LMS.
          </p>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant="destructive"
              disabled={isUnpublishing}
            >
              {isUnpublishing ? "Removing…" : "Confirm unpublish"}
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
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex flex-col items-start gap-1">
            <Button
              type="button"
              size="sm"
              disabled={publishBlocked !== null}
              aria-describedby={publishBlocked ? `${id}-publish-blocked` : undefined}
              onClick={() => setConfirm("publish")}
            >
              Publish…
            </Button>
            {publishBlocked && (
              <p id={`${id}-publish-blocked`} className="text-muted-foreground text-xs">
                {publishBlocked}
              </p>
            )}
          </div>
          {pub?.isPublished && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConfirm("unpublish")}
            >
              Unpublish…
            </Button>
          )}
        </div>
      )}
      {!outcome.fieldErrors && <Feedback state={outcome} />}
    </li>
  );
}

/**
 * Phase 22B-2 website publication for one Program's Batches. Only a public
 * label and the registration state (Open, Closed or Full) are published: no
 * capacity, seat counts, dates beyond the label, meeting links, locations,
 * notes, Trainer or internal name (P22-10). The Batch's own LMS status is
 * never changed here.
 */
export function BatchPublications({
  documentId,
  batches,
}: {
  documentId: string;
  batches: ProgramBatch[];
}) {
  if (batches.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        This Program has no Batches in the LMS yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {batches.map((batch) => (
        <BatchCard key={batch.id} documentId={documentId} batch={batch} />
      ))}
    </ul>
  );
}
