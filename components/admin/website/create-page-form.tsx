"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWebsitePageAction, type WebsiteActionState } from "@/lib/actions/website";
import { PAGE_KIND_LABELS, type AdminPageKind } from "@/lib/domain/website-admin";

const initialState: WebsiteActionState = {};

/**
 * Creates a website page. A one-per-site page needs one click (its key is
 * fixed); a legal page asks for its key, for example privacy-policy. Creating
 * a page makes an empty draft only: nothing is public.
 */
export function CreatePageForm({ kind }: { kind: AdminPageKind }) {
  const [state, formAction, isPending] = useActionState(
    createWebsitePageAction,
    initialState,
  );
  const label = PAGE_KIND_LABELS[kind];
  const keyError = state.fieldErrors?.pageKey?.[0];

  if (kind !== "legal") {
    return (
      <form action={formAction} className="flex flex-col items-start gap-1">
        <input type="hidden" name="kind" value={kind} />
        <Button type="submit" size="sm" variant="outline" disabled={isPending}>
          {isPending ? "Creating…" : `Create ${label}`}
        </Button>
        {state.error && (
          <p role="alert" className="text-destructive text-xs">
            {state.error}
          </p>
        )}
      </form>
    );
  }

  return (
    <form
      action={formAction}
      aria-label="Create a legal page"
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
    >
      <input type="hidden" name="kind" value="legal" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="legal-page-key">New legal page key</Label>
        <Input
          id="legal-page-key"
          name="pageKey"
          placeholder="privacy-policy"
          autoComplete="off"
          aria-invalid={keyError ? true : undefined}
          aria-describedby={keyError ? "legal-page-key-error" : "legal-page-key-hint"}
          className="sm:w-64"
        />
        {keyError ? (
          <p id="legal-page-key-error" className="text-destructive text-xs">
            {keyError}
          </p>
        ) : (
          <p id="legal-page-key-hint" className="text-muted-foreground text-xs">
            Lowercase letters, digits and hyphens. It names the page and cannot be
            changed.
          </p>
        )}
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending ? "Creating…" : "Create legal page"}
      </Button>
      {state.error && !keyError && (
        <p role="alert" className="text-destructive text-xs">
          {state.error}
        </p>
      )}
    </form>
  );
}
