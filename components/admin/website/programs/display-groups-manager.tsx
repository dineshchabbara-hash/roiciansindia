"use client";

import { useActionState, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createDisplayGroupAction,
  moveDisplayGroupAction,
  updateDisplayGroupAction,
  type ProgramActionState,
} from "@/lib/actions/website-programs";
import type { DisplayGroup } from "@/lib/data/website-programs";
import { WEBSITE_LIMITS } from "@/lib/domain/website";

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

function GroupRow({
  group,
  index,
  orderedIds,
}: {
  group: DisplayGroup;
  index: number;
  orderedIds: string[];
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
        </div>
      </div>
      <Feedback state={moveState} />
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

/**
 * Phase 22B-2 Program display groups. Names and order are data. Changes are
 * live (they apply to the public website straight away) and audited by the
 * database; moving a group submits the whole order that was shown, so a
 * concurrent change is refused rather than overwritten.
 */
export function DisplayGroupsManager({ groups }: { groups: DisplayGroup[] }) {
  const orderedIds = groups.map((g) => g.id);
  return (
    <div className="flex flex-col gap-6">
      <CreateGroupForm />
      <section aria-labelledby="groups-heading" className="flex flex-col gap-2">
        <h2 id="groups-heading" className="text-base font-semibold">
          Groups in display order
        </h2>
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
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
