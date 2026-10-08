/**
 * Phase 18 V1 (in-app notifications only). Pure helpers and limits shared by
 * validation, data, actions, and UI. The DB enforces the same title/body
 * limits (20260101000034's check constraints); these keep the form's own
 * errors in step with them.
 */

export const NOTIFICATION_TITLE_MAX = 200;
export const NOTIFICATION_BODY_MAX = 2000;

/** The only notification type an application user may create in V1. */
export const ADMIN_MESSAGE_TYPE = "admin_message";

/** Initial page sizes; the unread count is always a separate exact count. */
export const NOTIFICATION_INBOX_LIMIT = 50;
export const NOTIFICATION_SENT_HISTORY_LIMIT = 50;
export const NOTIFICATION_RECIPIENT_SEARCH_LIMIT = 20;

export const NOTIFICATION_RECIPIENT_KINDS = ["student", "trainer"] as const;
export type NotificationRecipientKind = (typeof NOTIFICATION_RECIPIENT_KINDS)[number];

export type NotificationRecipientRef = {
  kind: NotificationRecipientKind;
  profileId: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * The recipient picker posts `<kind>:<students.id|trainers.id>` — a profile
 * reference, never an auth.users id. The server resolves the canonical
 * auth user from that profile row itself.
 */
export function encodeRecipientRef(ref: NotificationRecipientRef): string {
  return `${ref.kind}:${ref.profileId}`;
}

export function parseRecipientRef(value: string): NotificationRecipientRef | null {
  const separator = value.indexOf(":");
  if (separator === -1) return null;
  const kind = value.slice(0, separator);
  const profileId = value.slice(separator + 1);
  if (!NOTIFICATION_RECIPIENT_KINDS.includes(kind as NotificationRecipientKind)) {
    return null;
  }
  if (!isUuid(profileId)) return null;
  return { kind: kind as NotificationRecipientKind, profileId };
}

/**
 * Keeps only characters that are safe inside a PostgREST `or()` filter
 * value (letters, digits, space, and the punctuation found in names and
 * email addresses), so a search term can never inject filter syntax.
 */
export function sanitizeRecipientSearch(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N} @._+-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Display-only; stored timestamps stay UTC (DATABASE_SCHEMA.md conventions). */
export function formatNotificationTimestamp(iso: string): string {
  return TIMESTAMP_FORMAT.format(new Date(iso));
}

export function formatUnreadCount(count: number): string {
  if (count === 0) return "No unread notifications";
  if (count === 1) return "1 unread notification";
  return `${count} unread notifications`;
}
