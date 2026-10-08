import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SendNotificationForm } from "@/components/admin/notifications/send-notification-form";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import {
  getSentNotifications,
  searchNotificationRecipients,
} from "@/lib/data/notifications";
import {
  NOTIFICATION_SENT_HISTORY_LIMIT,
  formatNotificationTimestamp,
} from "@/lib/domain/notifications";

export const dynamic = "force-dynamic";

const KIND_LABEL = { student: "Student", trainer: "Trainer" } as const;

/**
 * Phase 18 V1: in-app notifications only. An Admin/Super Admin finds one
 * Student or Trainer, sends a plain-text title and message, and sees the
 * notifications they themselves sent (RLS limits this list to own-sent
 * rows; there is no global view). Sent notifications cannot be edited or
 * deleted.
 */
export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const user = await getCurrentUserContext();
  if (!user || !isAdminOrSuperAdmin(user.role)) redirect("/login/admin");

  const params = await searchParams;
  const q = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim() ?? "";

  const [recipients, sent] = await Promise.all([
    q ? searchNotificationRecipients(q) : Promise.resolve(null),
    getSentNotifications(user.authUserId),
  ]);
  const options = recipients?.ok ? recipients.data : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-muted-foreground text-sm">
          Send an in-app notification to one Student or Trainer.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2>Send a notification</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form method="get" role="search" className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-64 flex-1 flex-col gap-1">
              <Label htmlFor="recipient-search">Find a Student or Trainer</Label>
              <Input
                id="recipient-search"
                name="q"
                defaultValue={q}
                placeholder="Name or email"
              />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>

          {recipients && !recipients.ok && (
            <p role="alert" className="text-destructive text-sm">
              {recipients.error}
            </p>
          )}
          {recipients?.ok && (
            <p className="text-muted-foreground text-sm">
              {options.length === 0
                ? "No Students or Trainers with a portal login match that search."
                : `${options.length} matching recipient${options.length === 1 ? "" : "s"}. Choose one below.`}
            </p>
          )}

          <SendNotificationForm options={options} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2>Recently sent</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!sent.ok ? (
            <p role="alert" className="text-destructive text-sm">
              {sent.error}
            </p>
          ) : sent.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              You have not sent any notifications yet.
            </p>
          ) : (
            <ul
              aria-label="Recently sent notifications"
              className="flex flex-col divide-y"
            >
              {sent.data.map((notification) => {
                const titleId = `sent-notification-${notification.id}-title`;
                return (
                  <li
                    key={notification.id}
                    aria-labelledby={titleId}
                    className="flex flex-col gap-1 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 id={titleId} className="font-medium">
                        {notification.title}
                      </h3>
                      <Badge variant={notification.isRead ? "outline" : "secondary"}>
                        {notification.isRead ? "Read by recipient" : "Not yet read"}
                      </Badge>
                    </div>
                    {notification.body && (
                      <p className="text-sm whitespace-pre-wrap">{notification.body}</p>
                    )}
                    <p className="text-muted-foreground text-xs">
                      To {notification.recipientName}
                      {notification.recipientKind
                        ? ` (${KIND_LABEL[notification.recipientKind]})`
                        : ""}
                      {" · "}
                      <time dateTime={notification.createdAt}>
                        {formatNotificationTimestamp(notification.createdAt)}
                      </time>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          {sent.ok && sent.data.length >= NOTIFICATION_SENT_HISTORY_LIMIT && (
            <p className="text-muted-foreground mt-2 text-xs">
              Showing your {NOTIFICATION_SENT_HISTORY_LIMIT} most recent notifications.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
