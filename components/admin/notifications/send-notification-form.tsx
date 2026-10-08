"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  sendNotificationAction,
  type SendNotificationFormState,
} from "@/lib/actions/notifications";
import type { NotificationRecipientOption } from "@/lib/data/notifications";
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TITLE_MAX,
  encodeRecipientRef,
} from "@/lib/domain/notifications";

const initialState: SendNotificationFormState = {};

const KIND_LABEL = { student: "Student", trainer: "Trainer" } as const;

/**
 * The recipient options come from the server-side search on the page; the
 * select posts a Student/Trainer profile reference, which the server
 * resolves to the canonical account itself. The form is always rendered
 * (never conditionally removed), so its error/success text stays visible
 * after the action settles; the durable proof of a send is the new row in
 * the page's "Recently sent" list.
 */
export function SendNotificationForm({
  options,
}: {
  options: NotificationRecipientOption[];
}) {
  const [state, formAction, isPending] = useActionState(
    sendNotificationAction,
    initialState,
  );
  const values = state.values ?? {};

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
      aria-label="Send a notification"
    >
      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="notification-recipient">Recipient</Label>
        <select
          id="notification-recipient"
          name="recipient"
          required
          defaultValue={values.recipient ?? ""}
          aria-invalid={!!state.fieldErrors?.recipient}
          aria-describedby={
            state.fieldErrors?.recipient ? "notification-recipient-error" : undefined
          }
          className="border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs"
        >
          <option value="" disabled>
            {options.length === 0 ? "Search for a recipient first" : "Select a recipient"}
          </option>
          {options.map((option) => (
            <option
              key={`${option.kind}:${option.profileId}`}
              value={encodeRecipientRef({
                kind: option.kind,
                profileId: option.profileId,
              })}
            >
              {option.name} ({KIND_LABEL[option.kind]}
              {option.email ? `, ${option.email}` : ""})
            </option>
          ))}
        </select>
        {state.fieldErrors?.recipient && (
          <p
            id="notification-recipient-error"
            role="alert"
            className="text-destructive text-xs"
          >
            {state.fieldErrors.recipient}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="notification-title">Title</Label>
        <Input
          id="notification-title"
          name="title"
          required
          maxLength={NOTIFICATION_TITLE_MAX}
          defaultValue={values.title ?? ""}
          aria-invalid={!!state.fieldErrors?.title}
          aria-describedby={
            state.fieldErrors?.title ? "notification-title-error" : undefined
          }
        />
        {state.fieldErrors?.title && (
          <p
            id="notification-title-error"
            role="alert"
            className="text-destructive text-xs"
          >
            {state.fieldErrors.title}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="notification-body">Message</Label>
        <textarea
          id="notification-body"
          name="body"
          required
          rows={4}
          maxLength={NOTIFICATION_BODY_MAX}
          defaultValue={values.body ?? ""}
          aria-invalid={!!state.fieldErrors?.body}
          aria-describedby={
            state.fieldErrors?.body ? "notification-body-error" : undefined
          }
          className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs"
        />
        {state.fieldErrors?.body && (
          <p
            id="notification-body-error"
            role="alert"
            className="text-destructive text-xs"
          >
            {state.fieldErrors.body}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending || options.length === 0}>
          Send notification
        </Button>
        {state.success && (
          <p className="text-sm text-green-700 dark:text-green-400">
            Notification sent. It now appears under Recently sent.
          </p>
        )}
      </div>
    </form>
  );
}
