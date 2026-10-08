import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { getInbox, getUnreadNotificationCount } from "@/lib/data/notifications";
import { NotificationInbox } from "@/components/notifications/notification-inbox";

export const dynamic = "force-dynamic";

export default async function StudentNotificationsPage() {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/student");

  const [inbox, unread] = await Promise.all([
    getInbox(user.authUserId),
    getUnreadNotificationCount(user.authUserId),
  ]);

  return (
    <NotificationInbox
      notifications={inbox.ok ? inbox.data : []}
      unreadCount={unread.ok ? unread.data : 0}
      loadError={inbox.ok ? undefined : inbox.error}
    />
  );
}
