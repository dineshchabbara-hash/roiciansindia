"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  type MarkNotificationFormState,
} from "@/lib/actions/notifications";

const initialState: MarkNotificationFormState = {};

/**
 * On success the server revalidates the portal layout: the item re-renders
 * as "Read" and this form is no longer rendered for it, so success needs
 * no message of its own. On failure nothing changes server-side, the form
 * stays mounted, and the error is shown here.
 */
export function MarkNotificationReadForm({
  notificationId,
  describedById,
}: {
  notificationId: string;
  describedById: string;
}) {
  const [state, formAction, isPending] = useActionState(
    markNotificationReadAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="notificationId" value={notificationId} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={isPending}
        aria-describedby={describedById}
      >
        Mark as read
      </Button>
      {state.formError && (
        <p role="alert" className="text-destructive text-xs">
          {state.formError}
        </p>
      )}
    </form>
  );
}

export function MarkAllNotificationsReadForm() {
  const [state, formAction, isPending] = useActionState(
    markAllNotificationsReadAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        Mark all as read
      </Button>
      {state.formError && (
        <p role="alert" className="text-destructive text-xs">
          {state.formError}
        </p>
      )}
    </form>
  );
}
