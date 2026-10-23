"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageStatusBadge } from "@/components/admin/website/page-status-badge";
import {
  moveFeaturedProgramAction,
  removeFeaturedProgramAction,
  type ProgramActionState,
} from "@/lib/actions/website-programs";
import type { WebsitePageStatus } from "@/lib/domain/website-admin";

const initialState: ProgramActionState = {};

export type FeaturedProgram = {
  documentId: string;
  version: number;
  programName: string;
  headline: string | null;
  status: WebsitePageStatus;
  featuredOrder: number | null;
};

type Pending =
  | { kind: "move"; documentId: string; direction: "up" | "down" }
  | { kind: "remove"; documentId: string };

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
 * Phase 22B-2 featured Programs in display order. Every move and removal is
 * confirmed first, applies to the public website straight away, and is
 * audited by the database. A move sends the list exactly as shown (ids and
 * versions); if anyone changed it meanwhile, nothing is written.
 */
export function FeaturedProgramsManager({ programs }: { programs: FeaturedProgram[] }) {
  const [pending, setPending] = useState<Pending | null>(null);
  // Only the most recent outcome is shown.
  const [lastOutcome, setLastOutcome] = useState<ProgramActionState>(initialState);
  const [, moveAction, isMoving] = useActionState(
    async (prev: ProgramActionState, formData: FormData) => {
      const result = await moveFeaturedProgramAction(prev, formData);
      setPending(null);
      setLastOutcome(result);
      return result;
    },
    initialState,
  );
  const [, removeAction, isRemoving] = useActionState(
    async (prev: ProgramActionState, formData: FormData) => {
      const result = await removeFeaturedProgramAction(prev, formData);
      setPending(null);
      setLastOutcome(result);
      return result;
    },
    initialState,
  );
  const seen = JSON.stringify(
    programs.map((p) => ({ id: p.documentId, version: p.version })),
  );

  if (programs.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No Programs are featured. Feature a Program from its Web address and placement
        screen.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Feedback state={lastOutcome} />
      <ol className="rounded-md border">
        {programs.map((p, index) => {
          const confirmingMove =
            pending?.kind === "move" && pending.documentId === p.documentId
              ? pending
              : null;
          const confirmingRemove =
            pending?.kind === "remove" && pending.documentId === p.documentId;
          return (
            <li
              key={p.documentId}
              className="flex flex-col gap-2 border-t p-4 first:border-t-0"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="font-medium">
                    <span className="text-muted-foreground mr-2 text-xs">
                      {index + 1}.
                    </span>
                    <Link
                      href={`/admin/website/programs/${p.documentId}/settings`}
                      className="underline-offset-4 hover:underline"
                    >
                      {p.headline ?? p.programName}
                    </Link>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <PageStatusBadge status={p.status} />
                    <span className="text-muted-foreground text-xs">{p.programName}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={index === 0 || isMoving}
                    aria-label={`Move ${p.programName} up`}
                    onClick={() =>
                      setPending({
                        kind: "move",
                        documentId: p.documentId,
                        direction: "up",
                      })
                    }
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={index === programs.length - 1 || isMoving}
                    aria-label={`Move ${p.programName} down`}
                    onClick={() =>
                      setPending({
                        kind: "move",
                        documentId: p.documentId,
                        direction: "down",
                      })
                    }
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isRemoving}
                    aria-label={`Remove ${p.programName} from featured`}
                    onClick={() =>
                      setPending({ kind: "remove", documentId: p.documentId })
                    }
                  >
                    Remove…
                  </Button>
                </div>
              </div>

              {confirmingMove && (
                <form
                  action={moveAction}
                  className="flex flex-col gap-2 rounded-md border p-3"
                >
                  <input type="hidden" name="documentId" value={p.documentId} />
                  <input
                    type="hidden"
                    name="direction"
                    value={confirmingMove.direction}
                  />
                  <input type="hidden" name="seen" value={seen} />
                  <p className="text-sm">
                    Move {p.programName} to position{" "}
                    {confirmingMove.direction === "up" ? index : index + 2}? It applies to
                    the public website straight away.
                  </p>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={isMoving}>
                      {isMoving ? "Saving…" : "Confirm move"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setPending(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
              {confirmingRemove && (
                <form
                  action={removeAction}
                  className="flex flex-col gap-2 rounded-md border p-3"
                >
                  <input type="hidden" name="documentId" value={p.documentId} />
                  <input type="hidden" name="expectedVersion" value={String(p.version)} />
                  <p className="text-sm">
                    Remove {p.programName} from the featured Programs? Its content, group
                    and publication are not changed.
                  </p>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={isRemoving}>
                      {isRemoving ? "Removing…" : "Confirm removal"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setPending(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
