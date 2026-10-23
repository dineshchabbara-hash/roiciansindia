"use client";

import { useActionState, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  archiveDisplayGroupAction,
  createDisplayGroupAction,
  moveDisplayGroupAction,
  restoreDisplayGroupAction,
  updateDisplayGroupAction,
  type ProgramActionState,
} from "@/lib/actions/website-programs";
import type { ArchivedDisplayGroup, DisplayGroup } from "@/lib/data/website-programs";
import { WEBSITE_LIMITS } from "@/lib/domain/website";
import { formatWebsiteTimestamp } from "@/lib/domain/website-admin";
import { restoreNameClash } from "@/lib/domain/website-programs";

const initialState: ProgramActionState = {};

function Feedback({ state }: { state: ProgramActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-destructive text-xs">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="text-xs text-green-800 dark:text-green-300">
        {state.message}
      </p>
    );
  }
  return null;
}

function CreateGroupForm() {
  const [state, formAction, isPending] = useActionState(
    createDisplayGroupAction,
    initialState,
  );
  const id = useId();
  const nameError = state.fieldErrors?.name?.[0];
  return (
    <form
      action={formAction}
      aria-label="Create a display group"
      className="flex flex-col gap-3 rounded-md border p-4"
    >
      <h2 className="text-base font-semibold">New display group</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-name`}>Group name</Label>
          <Input
            id={`${id}-name`}
            name="name"
            maxLength={WEBSITE_LIMITS.groupName}
            autoComplete="off"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${id}-name-error` : undefined}
          />
          {nameError && (
            <p id={`${id}-name-error`} className="text-destructive text-xs">
              {nameError}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-description`}>Description (optional)</Label>
          <Input
            id={`${id}-description`}
            name="description"
            maxLength={WEBSITE_LIMITS.groupDescription}
            autoComplete="off"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Creating…" : "Create group"}
        </Button>
        {!nameError && <Feedback state={state} />}
      </div>
      <p className="text-muted-foreground text-xs">
        New groups are added at the end of the list and are visible. A group appears on
        the public website only when it holds published Programs.
      </p>
    </form>
  );
}

type ArchiveControls = {
  confirming: boolean;
  onRequest: () => void;
  onCancel: () => void;
  action: (formData: FormData) => void;
  isPending: boolean;
};

function GroupRow({
  group,
  index,
  orderedIds,
  archive,
}: {
  group: DisplayGroup;
  index: number;
  orderedIds: string[];
  archive: ArchiveControls;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, isPending] = useActionState(
    async (prev: ProgramActionState, formData: FormData) => {
      const result = await updateDisplayGroupAction(prev, formData);
      if (!result.error) setEditing(false);
      return result;
    },
    initialState,
  );
  const [moveState, moveAction, isMoving] = useActionState(
    moveDisplayGroupAction,
    initialState,
  );
  const id = useId();
  const expectedVersion = Math.max(group.version, state.version ?? 0);
  const nameError = state.fieldErrors?.name?.[0];
  const holdsPrograms = group.programCount > 0;

  return (
    <li className="flex flex-col gap-2 border-t p-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium">
            <span className="text-muted-foreground mr-2 text-xs">{index + 1}.</span>
            {group.name}
          </p>
          {group.description && (
            <p className="text-muted-foreground text-xs">{group.description}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Badge variant={group.isVisible ? "success" : "secondary"}>
              {group.isVisible ? "Visible" : "Hidden"}
            </Badge>
            <span className="text-muted-foreground text-xs">
              {group.programCount === 1 ? "1 Program" : `${group.programCount} Programs`}
            </span>
          </div>
          {holdsPrograms && (
            <p id={`${id}-archive-blocked`} className="text-muted-foreground text-xs">
              To archive this group, first move its Programs to another group, or hide the
              group instead.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(["up", "down"] as const).map((direction) => (
            <form key={direction} action={moveAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="direction" value={direction} />
              <input type="hidden" name="orderedIds" value={JSON.stringify(orderedIds)} />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                disabled={
                  isMoving ||
                  (direction === "up" ? index === 0 : index === orderedIds.length - 1)
                }
                aria-label={`Move ${group.name} ${direction}`}
              >
                {direction === "up" ? "↑" : "↓"}
              </Button>
            </form>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            aria-label={`Edit ${group.name}`}
          >
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={holdsPrograms || archive.isPending}
            onClick={archive.onRequest}
            aria-label={`Archive ${group.name}`}
            aria-describedby={holdsPrograms ? `${id}-archive-blocked` : undefined}
          >
            Archive…
          </Button>
        </div>
      </div>
      <Feedback state={moveState} />
      {archive.confirming && (
        <form
          action={archive.action}
          className="flex flex-col gap-2 rounded-md border p-3"
        >
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="expectedVersion" value={String(expectedVersion)} />
          <p className="text-sm">
            Archive &quot;{group.name}&quot;? It holds no Programs. It will leave the
            display order and will not appear on the website. You can restore it later
            from Archived groups.
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={archive.isPending}>
              {archive.isPending ? "Archiving…" : "Confirm archive"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={archive.onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {editing ? (
        <form action={formAction} className="flex flex-col gap-3 rounded-md border p-3">
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="expectedVersion" value={String(expectedVersion)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-name`}>Group name</Label>
              <Input
                id={`${id}-name`}
                name="name"
                defaultValue={group.name}
                maxLength={WEBSITE_LIMITS.groupName}
                aria-invalid={nameError ? true : undefined}
              />
              {nameError && <p className="text-destructive text-xs">{nameError}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-description`}>Description (optional)</Label>
              <Input
                id={`${id}-description`}
                name="description"
                defaultValue={group.description ?? ""}
                maxLength={WEBSITE_LIMITS.groupDescription}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isVisible" defaultChecked={group.isVisible} />
            Visible on the website (hidden groups keep their Programs but are not shown)
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : "Save group"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
          {!nameError && <Feedback state={state} />}
        </form>
      ) : (
        !state.error && <Feedback state={state} />
      )}
    </li>
  );
}

function ArchivedGroupRow({
  group,
  nameTaken,
  restoreAction,
  isRestoring,
}: {
  group: ArchivedDisplayGroup;
  nameTaken: boolean;
  restoreAction: (formData: FormData) => void;
  isRestoring: boolean;
}) {
  const id = useId();
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-t p-4 first:border-t-0">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium">{group.name}</p>
        {group.description && (
          <p className="text-muted-foreground text-xs">{group.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Archived</Badge>
          <span className="text-muted-foreground text-xs">
            Archived {formatWebsiteTimestamp(group.archivedAt)}
          </span>
        </div>
        {nameTaken && (
          <p
            id={`${id}-name-taken`}
            className="text-xs text-amber-800 dark:text-amber-300"
          >
            An active group already uses this name. Rename or archive that group before
            restoring this one.
          </p>
        )}
      </div>
      <form action={restoreAction}>
        <input type="hidden" name="groupId" value={group.id} />
        <input type="hidden" name="expectedVersion" value={String(group.version)} />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={nameTaken || isRestoring}
          aria-label={`Restore ${group.name}`}
          aria-describedby={nameTaken ? `${id}-name-taken` : undefined}
        >
          {isRestoring ? "Restoring…" : "Restore"}
        </Button>
      </form>
    </li>
  );
}

/**
 * Phase 22B-2 Program display groups. Names and order are data. Changes are
 * live (they apply to the public website straight away) and audited by the
 * database; moving a group submits the whole order that was shown, so a
 * concurrent change is refused rather than overwritten.
 *
 * Archive (confirmed first) and restore use the Phase 22A database function,
 * which also refuses to archive a group holding Programs and to restore a
 * group whose name an active group now uses. Archived groups are listed
 * separately with a Restore button; a restored group goes last.
 */
export function DisplayGroupsManager({
  groups,
  archivedGroups = [],
}: {
  groups: DisplayGroup[];
  archivedGroups?: ArchivedDisplayGroup[];
}) {
  const orderedIds = groups.map((g) => g.id);
  const activeNames = groups.map((g) => g.name);
  const [confirmingArchive, setConfirmingArchive] = useState<string | null>(null);
  // Only the most recent archive or restore outcome is shown; the row itself
  // moves between the lists, so the outcome is kept here.
  const [lastOutcome, setLastOutcome] = useState<ProgramActionState>(initialState);
  const [, archiveAction, isArchiving] = useActionState(
    async (prev: ProgramActionState, formData: FormData) => {
      const result = await archiveDisplayGroupAction(prev, formData);
      setConfirmingArchive(null);
      setLastOutcome(result);
      return result;
    },
    initialState,
  );
  const [, restoreAction, isRestoring] = useActionState(
    async (prev: ProgramActionState, formData: FormData) => {
      const result = await restoreDisplayGroupAction(prev, formData);
      setLastOutcome(result);
      return result;
    },
    initialState,
  );

  return (
    <div className="flex flex-col gap-6">
      <CreateGroupForm />
      <section aria-labelledby="groups-heading" className="flex flex-col gap-2">
        <h2 id="groups-heading" className="text-base font-semibold">
          Groups in display order
        </h2>
        <Feedback state={lastOutcome} />
        {groups.length === 0 ? (
          <p className="text-muted-foreground text-sm">No display groups yet.</p>
        ) : (
          <ol className="rounded-md border">
            {groups.map((group, index) => (
              <GroupRow
                key={group.id}
                group={group}
                index={index}
                orderedIds={orderedIds}
                archive={{
                  confirming: confirmingArchive === group.id,
                  onRequest: () => {
                    setLastOutcome(initialState);
                    setConfirmingArchive(group.id);
                  },
                  onCancel: () => setConfirmingArchive(null),
                  action: archiveAction,
                  isPending: isArchiving,
                }}
              />
            ))}
          </ol>
        )}
      </section>
      <section aria-labelledby="archived-groups-heading" className="flex flex-col gap-2">
        <h2 id="archived-groups-heading" className="text-base font-semibold">
          Archived groups
        </h2>
        <p className="text-muted-foreground text-xs">
          Archived groups are not shown on the website and are not in the display order.
          Restoring a group puts it last in the order and keeps its visibility setting.
        </p>
        {archivedGroups.length === 0 ? (
          <p className="text-muted-foreground text-sm">No archived groups.</p>
        ) : (
          <ul aria-label="Archived groups" className="rounded-md border">
            {archivedGroups.map((group) => (
              <ArchivedGroupRow
                key={group.id}
                group={group}
                nameTaken={restoreNameClash(group.name, activeNames)}
                restoreAction={restoreAction}
                isRestoring={isRestoring}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
