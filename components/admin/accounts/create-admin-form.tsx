"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAdminAccountAction, type AccountFormState } from "@/lib/actions/accounts";
import { ACTIVATION_INSTRUCTIONS } from "@/lib/domain/accounts";

const initialState: AccountFormState = {};

/**
 * Phase 21C — Super Admin creates an Admin login. Names and email only:
 * the role is always "admin" (set by the server), and no password is
 * chosen here — the new admin sets their own.
 */
export function CreateAdminForm() {
  const [state, formAction, isPending] = useActionState(
    createAdminAccountAction,
    initialState,
  );
  const errors = state.fieldErrors ?? {};
  return (
    <form
      action={formAction}
      aria-label="Create admin account"
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 md:grid-cols-3">
        {(
          [
            ["firstName", "First name", "text"],
            ["lastName", "Last name", "text"],
            ["email", "Email", "email"],
          ] as const
        ).map(([name, label, type]) => (
          <div key={name} className="flex flex-col gap-1.5">
            <Label htmlFor={`admin-${name}`}>{label}</Label>
            <Input
              id={`admin-${name}`}
              name={name}
              type={type}
              required
              aria-invalid={errors[name]?.length ? true : undefined}
            />
            {errors[name]?.length ? (
              <p className="text-destructive text-xs">{errors[name]![0]}</p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        The account gets the Admin role. {ACTIVATION_INSTRUCTIONS}
      </p>
      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {state.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating..." : "Create admin account"}
        </Button>
      </div>
    </form>
  );
}
