import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  MarkAllNotificationsReadForm,
  MarkNotificationReadForm,
} from "@/components/notifications/notification-read-forms";
import type { InboxNotification } from "@/lib/data/notifications";
import {
  NOTIFICATION_INBOX_LIMIT,
  formatNotificationTimestamp,
  formatUnreadCount,
} from "@/lib/domain/notifications";

/**
 * Shared Student/Trainer inbox (Phase 18 V1). Server-rendered from durable
 * state only: each item's own "Unread"/"Read" status text and the exact
 * unread count come from the database on every render, so they survive a
 * reload and never depend on a transient client message. Title and body
 * are rendered as plain text (React escapes them; no HTML or markdown).
 */
export function NotificationInbox({
  notifications,
  unreadCount,
  loadError,
}: {
  notifications: InboxNotification[];
  unreadCount: number;
  loadError?: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-muted-foreground text-sm">
            {formatUnreadCount(unreadCount)}
          </p>
        </div>
        {unreadCount > 0 && <MarkAllNotificationsReadForm />}
      </div>

      {loadError ? (
        <p role="alert" className="text-destructive text-sm">
          {loadError}
        </p>
      ) : notifications.length === 0 ? (
        <p className="text-muted-foreground text-sm">You have no notifications yet.</p>
      ) : (
        <ul aria-label="Your notifications" className="flex flex-col gap-3">
          {notifications.map((notification) => {
            const titleId = `notification-${notification.id}-title`;
            return (
              <li key={notification.id} aria-labelledby={titleId}>
                <Card className={notification.isRead ? undefined : "border-primary"}>
                  <CardContent className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 id={titleId} className="font-semibold">
                        {notification.title}
                      </h2>
                      <Badge variant={notification.isRead ? "outline" : "default"}>
                        {notification.isRead ? "Read" : "Unread"}
                      </Badge>
                    </div>
                    {notification.body && (
                      <p className="text-sm whitespace-pre-wrap">{notification.body}</p>
                    )}
                    <p className="text-muted-foreground text-xs">
                      <time dateTime={notification.createdAt}>
                        {formatNotificationTimestamp(notification.createdAt)}
                      </time>
                    </p>
                    {!notification.isRead && (
                      <MarkNotificationReadForm
                        notificationId={notification.id}
                        describedById={titleId}
                      />
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {notifications.length >= NOTIFICATION_INBOX_LIMIT && (
        <p className="text-muted-foreground text-xs">
          Showing your {NOTIFICATION_INBOX_LIMIT} most recent notifications.
        </p>
      )}
    </div>
  );
}
