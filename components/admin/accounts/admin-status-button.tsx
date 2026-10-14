"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  setAdminAccountStatusAction,
  type AccountFormState,
} from "@/lib/actions/accounts";

const initialState: AccountFormState = {};

/** Phase 21C — deactivate / reactivate one Admin (Super Admin only). */
export function AdminStatusButton({
  adminId,
  name,
  status,
}: {
  adminId: string;
  name: string;
  status: "active" | "inactive";
}) {
  const [state, formAction, isPending] = useActionState(
    setAdminAccountStatusAction,
    initialState,
  );
  const next = status === "active" ? "inactive" : "active";
  const label = status === "active" ? "Deactivate" : "Reactivate";
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="adminId" value={adminId} />
      <input type="hidden" name="status" value={next} />
      <Button
        type="submit"
        size="sm"
        variant={status === "active" ? "destructive" : "outline"}
        disabled={isPending}
        aria-label={`${label} ${name}`}
      >
        {isPending ? "Saving..." : label}
      </Button>
      {state.formError && (
        <span role="alert" className="text-destructive text-xs">
          {state.formError}
        </span>
      )}
    </form>
  );
}
