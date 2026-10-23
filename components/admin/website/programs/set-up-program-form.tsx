"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createProgramWebsiteAction,
  type ProgramActionState,
} from "@/lib/actions/website-programs";

const initialState: ProgramActionState = {};

/**
 * Creates the (empty, unpublished) website entry for one Program, with its
 * web address. The suggested address comes from the Program's name and can
 * be edited; nothing else is copied from the LMS Program.
 */
export function SetUpProgramForm({
  programId,
  programName,
  suggestedSlug,
}: {
  programId: string;
  programName: string;
  suggestedSlug: string;
}) {
  const [state, formAction, isPending] = useActionState(
    createProgramWebsiteAction,
    initialState,
  );
  const id = useId();
  const slugError = state.fieldErrors?.slug?.[0];
  return (
    <form
      action={formAction}
      aria-label={`Set up website content for ${programName}`}
      className="flex flex-col gap-1.5"
    >
      <input type="hidden" name="programId" value={programId} />
      <Label htmlFor={`${id}-slug`} className="text-xs">
        Web address
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">/programs/</span>
        <Input
          id={`${id}-slug`}
          name="slug"
          defaultValue={suggestedSlug}
          autoComplete="off"
          className="h-8 w-72 max-w-full"
          aria-invalid={slugError ? true : undefined}
          aria-describedby={slugError ? `${id}-error` : undefined}
        />
        <Button type="submit" size="sm" variant="outline" disabled={isPending}>
          {isPending ? "Setting up…" : "Set up website content"}
        </Button>
      </div>
      {slugError ? (
        <p id={`${id}-error`} className="text-destructive text-xs">
          {slugError}
        </p>
      ) : state.error ? (
        <p role="alert" className="text-destructive text-xs">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
