import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import {
  ADMIN_MESSAGE_TYPE,
  NOTIFICATION_INBOX_LIMIT,
  NOTIFICATION_RECIPIENT_SEARCH_LIMIT,
  NOTIFICATION_SENT_HISTORY_LIMIT,
  sanitizeRecipientSearch,
  type NotificationRecipientKind,
  type NotificationRecipientRef,
} from "@/lib/domain/notifications";

/**
 * Phase 18 V1 notifications. Every function uses the caller's own
 * RLS-scoped session (never the service-role client), so the
 * 20260101000034 policies are the real boundary: recipients read/mark only
 * their own rows, Admin/Super Admin additionally read only what they sent,
 * and an insert must name the caller as sender. The explicit
 * recipient/sender filters below narrow results for the UI; they are not
 * the security boundary.
 */

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[notifications data] ${message}:`, error);
  return { ok: false, error: message };
}

export type NotificationRecipientOption = {
  kind: NotificationRecipientKind;
  profileId: string;
  name: string;
  email: string;
};

export type InboxNotification = {
  id: string;
  title: string;
  body: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

export type SentNotification = {
  id: string;
  title: string;
  body: string | null;
  isRead: boolean;
  createdAt: string;
  recipientName: string;
  recipientKind: NotificationRecipientKind | null;
};

type PersonRow = {
  id: string;
  auth_user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
};

function fullName(row: { first_name: string; last_name: string }): string {
  return `${row.first_name} ${row.last_name}`.trim();
}

// ---------------------------------------------------------------------------
// Admin: recipient picker.

/**
 * Students and Trainers with a portal login whose name or email matches.
 * Empty/blank searches return nothing rather than an unbounded list.
 */
export async function searchNotificationRecipients(
  rawQuery: string,
): Promise<DataResult<NotificationRecipientOption[]>> {
  const q = sanitizeRecipientSearch(rawQuery);
  if (q.length < 2) return { ok: true, data: [] };

  try {
    const supabase = await createSupabaseServerClient();
    const filter = `first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`;
    const [students, trainers] = await Promise.all([
      supabase
        .from("students")
        .select("id, auth_user_id, first_name, last_name, email")
        .not("auth_user_id", "is", null)
        .or(filter)
        .order("first_name", { ascending: true })
        .limit(NOTIFICATION_RECIPIENT_SEARCH_LIMIT),
      supabase
        .from("trainers")
        .select("id, auth_user_id, first_name, last_name, email")
        .or(filter)
        .order("first_name", { ascending: true })
        .limit(NOTIFICATION_RECIPIENT_SEARCH_LIMIT),
    ]);
    if (students.error) throw students.error;
    if (trainers.error) throw trainers.error;

    const toOption =
      (kind: NotificationRecipientKind) =>
      (row: PersonRow): NotificationRecipientOption => ({
        kind,
        profileId: row.id,
        name: fullName(row),
        email: row.email ?? "",
      });

    return {
      ok: true,
      data: [
        ...((students.data ?? []) as PersonRow[]).map(toOption("student")),
        ...((trainers.data ?? []) as PersonRow[]).map(toOption("trainer")),
      ],
    };
  } catch (error) {
    return fail("Could not search recipients.", error);
  }
}

/**
 * Resolves the canonical auth.users id for a Student/Trainer profile chosen
 * in the picker. The browser only ever posts a profile reference; it never
 * supplies an auth user id.
 */
export async function resolveNotificationRecipient(
  ref: NotificationRecipientRef,
): Promise<
  DataResult<{ authUserId: string; name: string; kind: NotificationRecipientKind }>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const table = ref.kind === "student" ? "students" : "trainers";
    const { data, error } = await supabase
      .from(table)
      .select("id, auth_user_id, first_name, last_name, email")
      .eq("id", ref.profileId)
      .maybeSingle();
    if (error) throw error;
    const row = data as PersonRow | null;
    if (!row) return { ok: false, error: "That recipient no longer exists." };
    if (!row.auth_user_id) {
      return { ok: false, error: "That recipient does not have a portal login yet." };
    }
    return {
      ok: true,
      data: { authUserId: row.auth_user_id, name: fullName(row), kind: ref.kind },
    };
  } catch (error) {
    return fail("Could not look up the recipient.", error);
  }
}

// ---------------------------------------------------------------------------
// Admin: send + sent history.

export async function sendNotificationRecord(input: {
  senderAuthUserId: string;
  recipientAuthUserId: string;
  title: string;
  body: string;
}): Promise<DataResult<{ id: string }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("notifications")
      .insert({
        recipient_auth_user_id: input.recipientAuthUserId,
        created_by_auth_user_id: input.senderAuthUserId,
        type: ADMIN_MESSAGE_TYPE,
        title: input.title,
        body: input.body,
        channel: "in_app",
        status: "unread",
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true, data: { id: data.id as string } };
  } catch (error) {
    return fail("Could not send the notification. Please try again.", error);
  }
}

export async function getSentNotifications(
  senderAuthUserId: string,
): Promise<DataResult<SentNotification[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("notifications")
      .select("id, title, body, status, created_at, recipient_auth_user_id")
      .eq("created_by_auth_user_id", senderAuthUserId)
      .order("created_at", { ascending: false })
      .limit(NOTIFICATION_SENT_HISTORY_LIMIT);
    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      title: string;
      body: string | null;
      status: "unread" | "read";
      created_at: string;
      recipient_auth_user_id: string;
    }>;
    const recipientIds = [...new Set(rows.map((r) => r.recipient_auth_user_id))];

    const names = new Map<string, { name: string; kind: NotificationRecipientKind }>();
    if (recipientIds.length > 0) {
      const [students, trainers] = await Promise.all([
        supabase
          .from("students")
          .select("auth_user_id, first_name, last_name")
          .in("auth_user_id", recipientIds),
        supabase
          .from("trainers")
          .select("auth_user_id, first_name, last_name")
          .in("auth_user_id", recipientIds),
      ]);
      if (students.error) throw students.error;
      if (trainers.error) throw trainers.error;
      for (const s of (students.data ?? []) as PersonRow[]) {
        if (s.auth_user_id)
          names.set(s.auth_user_id, { name: fullName(s), kind: "student" });
      }
      for (const t of (trainers.data ?? []) as PersonRow[]) {
        if (t.auth_user_id)
          names.set(t.auth_user_id, { name: fullName(t), kind: "trainer" });
      }
    }

    return {
      ok: true,
      data: rows.map((r) => {
        const recipient = names.get(r.recipient_auth_user_id);
        return {
          id: r.id,
          title: r.title,
          body: r.body,
          isRead: r.status === "read",
          createdAt: r.created_at,
          recipientName: recipient?.name ?? "Unknown recipient",
          recipientKind: recipient?.kind ?? null,
        };
      }),
    };
  } catch (error) {
    return fail("Could not load sent notifications.", error);
  }
}

// ---------------------------------------------------------------------------
// Recipient (Student/Trainer): inbox, unread count, mark read.

export async function getInbox(
  recipientAuthUserId: string,
): Promise<DataResult<InboxNotification[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("notifications")
      .select("id, title, body, status, read_at, created_at")
      .eq("recipient_auth_user_id", recipientAuthUserId)
      .order("created_at", { ascending: false })
      .limit(NOTIFICATION_INBOX_LIMIT);
    if (error) throw error;
    return {
      ok: true,
      data: (
        (data ?? []) as Array<{
          id: string;
          title: string;
          body: string | null;
          status: "unread" | "read";
          read_at: string | null;
          created_at: string;
        }>
      ).map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        isRead: r.status === "read",
        readAt: r.read_at,
        createdAt: r.created_at,
      })),
    };
  } catch (error) {
    return fail("Could not load notifications.", error);
  }
}

/** Exact count, independent of how many inbox rows are rendered. */
export async function getUnreadNotificationCount(
  recipientAuthUserId: string,
): Promise<DataResult<number>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_auth_user_id", recipientAuthUserId)
      .eq("status", "unread");
    if (error) throw error;
    return { ok: true, data: count ?? 0 };
  } catch (error) {
    return fail("Could not load the unread count.", error);
  }
}

/**
 * Idempotent: marking an already-read own notification succeeds without
 * changing its read_at. A notification that isn't the caller's own is
 * invisible under RLS and reported as not found.
 */
export async function markNotificationReadRecord(input: {
  notificationId: string;
  recipientAuthUserId: string;
}): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: updated, error } = await supabase
      .from("notifications")
      .update({ status: "read", read_at: new Date().toISOString() })
      .eq("id", input.notificationId)
      .eq("recipient_auth_user_id", input.recipientAuthUserId)
      .eq("status", "unread")
      .select("id");
    if (error) throw error;
    if ((updated ?? []).length > 0) return { ok: true, data: null };

    const { data: existing, error: fetchError } = await supabase
      .from("notifications")
      .select("id")
      .eq("id", input.notificationId)
      .eq("recipient_auth_user_id", input.recipientAuthUserId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return { ok: false, error: "Notification not found." };
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not mark the notification as read.", error);
  }
}

export async function markAllNotificationsReadRecord(
  recipientAuthUserId: string,
): Promise<DataResult<{ updated: number }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("notifications")
      .update({ status: "read", read_at: new Date().toISOString() })
      .eq("recipient_auth_user_id", recipientAuthUserId)
      .eq("status", "unread")
      .select("id");
    if (error) throw error;
    return { ok: true, data: { updated: (data ?? []).length } };
  } catch (error) {
    return fail("Could not mark notifications as read.", error);
  }
}
