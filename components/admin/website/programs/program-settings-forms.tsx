"use client";

import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changeProgramSlugAction,
  updateProgramPlacementAction,
  type ProgramActionState,
} from "@/lib/actions/website-programs";
import { PUBLISHED_SLUG_LOCKED_MESSAGE } from "@/lib/domain/website-programs";

const initialState: ProgramActionState = {};

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

/**
 * The Program's public web address. Locked once the Program has been
 * published (for Admin and Super Admin alike) until redirects from old
 * addresses exist; the server action refuses too.
 */
export function ProgramSlugForm({
  documentId,
  slug,
  version,
  locked,
}: {
  documentId: string;
  slug: string;
  version: number;
  locked: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    changeProgramSlugAction,
    initialState,
  );
  const id = useId();
  // Versions only increase: take whichever is newer, the page's or ours.
  const expectedVersion = Math.max(version, state.version ?? 0);
  const slugError = state.fieldErrors?.slug?.[0];

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-3 rounded-md border p-4"
    >
      <h2 id={`${id}-heading`} className="text-base font-semibold">
        Web address
      </h2>
      {locked ? (
        <>
          <p className="text-sm">
            <code>/programs/{slug}</code>
          </p>
          <p
            id={`${id}-locked`}
            className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            {PUBLISHED_SLUG_LOCKED_MESSAGE}
          </p>
        </>
      ) : (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="documentId" value={documentId} />
          <input type="hidden" name="expectedVersion" value={String(expectedVersion)} />
          <Label htmlFor={`${id}-slug`}>New web address</Label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-sm">/programs/</span>
            <Input
              id={`${id}-slug`}
              name="slug"
              defaultValue={slug}
              autoComplete="off"
              className="w-64"
              aria-invalid={slugError ? true : undefined}
              aria-describedby={`${id}-slug-hint`}
            />
            <Button type="submit" size="sm" variant="outline" disabled={isPending}>
              {isPending ? "Saving…" : "Change web address"}
            </Button>
          </div>
          <p id={`${id}-slug-hint`} className="text-muted-foreground text-xs">
            {slugError ??
              "3–100 lowercase letters, digits and single hyphens. It can be changed until the Program is first published; after that it stays fixed."}
          </p>
          {!slugError && <Feedback state={state} />}
        </form>
      )}
    </section>
  );
}

export type GroupOption = { id: string; name: string; isVisible: boolean };

/**
 * Display group, order within the catalogue, and featured status. These are
 * live settings (not drafts): they apply to the public website as soon as
 * they are saved, so saving asks for confirmation. Each change is audited by
 * the database.
 */
export function ProgramPlacementForm({
  documentId,
  programName,
  version,
  groups,
  placement,
}: {
  documentId: string;
  programName: string;
  version: number;
  groups: GroupOption[];
  placement: {
    displayGroupId: string | null;
    isFeatured: boolean;
    featuredOrder: number | null;
    displayOrder: number | null;
  };
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, isPending] = useActionState(
    async (prev: ProgramActionState, formData: FormData) => {
      const result = await updateProgramPlacementAction(prev, formData);
      setConfirming(false);
      return result;
    },
    initialState,
  );
  const id = useId();
  const [groupId, setGroupId] = useState(placement.displayGroupId ?? "");
  const [displayOrder, setDisplayOrder] = useState(
    placement.displayOrder === null ? "" : String(placement.displayOrder),
  );
  const [isFeatured, setIsFeatured] = useState(placement.isFeatured);
  const [featuredOrder, setFeaturedOrder] = useState(
    placement.featuredOrder === null ? "" : String(placement.featuredOrder),
  );
  const expectedVersion = Math.max(version, state.version ?? 0);
  const featuredChange =
    isFeatured === placement.isFeatured
      ? null
      : isFeatured
        ? `${programName} will be added to the featured Programs.`
        : `${programName} will be removed from the featured Programs.`;

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-3 rounded-md border p-4"
    >
      <h2 id={`${id}-heading`} className="text-base font-semibold">
        Placement on the website
      </h2>
      <p className="text-muted-foreground text-sm">
        Placement takes effect on the public website as soon as you save it, whenever this
        Program&apos;s content is published.
      </p>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="documentId" value={documentId} />
        <input type="hidden" name="expectedVersion" value={String(expectedVersion)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-group`}>Display group</Label>
            <select
              id={`${id}-group`}
              name="displayGroupId"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            >
              <option value="">No group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.isVisible ? "" : " (hidden)"}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-order`}>Order within the group</Label>
            <Input
              id={`${id}-order`}
              name="displayOrder"
              inputMode="numeric"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
              aria-describedby={`${id}-order-hint`}
              aria-invalid={state.fieldErrors?.displayOrder ? true : undefined}
            />
            <p id={`${id}-order-hint`} className="text-muted-foreground text-xs">
              {state.fieldErrors?.displayOrder?.[0] ??
                "1 is shown first. Leave empty to sort by name."}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isFeatured"
              checked={isFeatured}
              onChange={(e) => setIsFeatured(e.target.checked)}
            />
            Featured Program
          </label>
          {isFeatured && (
            <div className="flex flex-col gap-1.5 sm:w-1/2">
              <Label htmlFor={`${id}-featured-order`}>Featured position</Label>
              <Input
                id={`${id}-featured-order`}
                name="featuredOrder"
                inputMode="numeric"
                value={featuredOrder}
                onChange={(e) => setFeaturedOrder(e.target.value)}
                aria-describedby={`${id}-featured-hint`}
                aria-invalid={state.fieldErrors?.featuredOrder ? true : undefined}
              />
              <p id={`${id}-featured-hint`} className="text-muted-foreground text-xs">
                {state.fieldErrors?.featuredOrder?.[0] ??
                  "Leave empty to add it after the current featured Programs. Reorder them under Featured Programs."}
              </p>
            </div>
          )}
        </div>

        {confirming ? (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <p className="text-sm">
              Save this placement? It applies to the public website straight away.
              {featuredChange ? ` ${featuredChange}` : ""}
            </p>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Saving…" : "Confirm placement"}
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
          </div>
        ) : (
          <div>
            <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
              Save placement…
            </Button>
          </div>
        )}
        <Feedback state={state} />
      </form>
    </section>
  );
}
