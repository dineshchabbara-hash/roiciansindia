"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  provisionStudentPortalAccessAction,
  type AccountFormState,
} from "@/lib/actions/accounts";

const initialState: AccountFormState = {};

/**
 * Phase 21C — Admin gives an existing student a portal login. Only the
 * student id is submitted: the login email is the student's own email,
 * the role is always "student", and no password is set here.
 */
export function ProvisionPortalAccessButton({
  studentId,
  showButton,
}: {
  studentId: string;
  /** False once the student has a login: the result message stays visible. */
  showButton: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    provisionStudentPortalAccessAction,
    initialState,
  );
  return (
    <div className="flex flex-col gap-2">
      {showButton && (
        <form action={formAction} aria-label="Give portal access">
          <input type="hidden" name="studentId" value={studentId} />
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Creating login..." : "Give portal access"}
          </Button>
        </form>
      )}
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
    </div>
  );
}
