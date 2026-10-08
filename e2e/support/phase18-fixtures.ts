import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

/**
 * Node-side setup/teardown for the Phase 18 (Notifications V1) live-data E2E
 * suite (e2e/phase18-notifications.spec.ts). Self-contained, same reasoning
 * as every prior phase's own fixtures file.
 *
 * Authorization discipline (the Phase 17 lesson): the service-role client is
 * used ONLY to create/delete exact synthetic identities and rows and for
 * read-only verification. Anything that is itself a production operation —
 * sending a notification, or proving what a Student/Trainer/anon caller can
 * and cannot do — goes through a normal anon-key client signed in as the
 * real synthetic user, so the notifications RLS policies (20260101000034)
 * are what actually decide the outcome.
 *
 * This is intentionally NOT a .spec.ts file.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export { hasRealSupabaseCredentials } from "./phase5-fixtures";

export const PHASE18_E2E_EMAIL_DOMAIN = "phase18-e2e.internal.test";
export const PHASE18_E2E_PREFIX = "Phase18E2E";
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export type Phase18DeleteResult = { ok: boolean; reason?: string };

function serviceClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing real Supabase credentials — call hasRealSupabaseCredentials() first.",
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function anonClient(): SupabaseClient {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — needed for authenticated fixture clients.",
    );
  }
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function safely<T = unknown>(
  operation: () => PromiseLike<{ data?: T | null; error: { message: string } | null }>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    const result = await operation();
    return { data: result.data ?? null, error: result.error };
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  }
}

// ---------------------------------------------------------------------------
// Identities. Every identity is unique per call (tag + RUN_ID); nothing is
// shared between describe blocks.

export type Phase18Role = "admin" | "student" | "trainer";

export type Phase18Identity = {
  role: Phase18Role;
  authUserId: string;
  email: string;
  password: string;
  /** admins.id / students.id / trainers.id once created, else null. */
  profileId: string | null;
  firstName: string;
  lastName: string;
};

export class Phase18PartialIdentityError extends Error {
  partial: Phase18Identity;
  constructor(message: string, partial: Phase18Identity) {
    super(message);
    this.name = "Phase18PartialIdentityError";
    this.partial = partial;
  }
}

const LAST_NAME: Record<Phase18Role, string> = {
  admin: "Admin",
  student: "Student",
  trainer: "Trainer",
};

export function displayName(identity: Phase18Identity): string {
  return `${identity.firstName} ${identity.lastName}`;
}

export async function createPhase18Identity(
  role: Phase18Role,
  tag: string,
): Promise<Phase18Identity> {
  const supabase = serviceClient();
  const firstName = `${PHASE18_E2E_PREFIX}${tag}`;
  const lastName = LAST_NAME[role];
  const email = `phase18-e2e-${role}-${tag.toLowerCase()}-${RUN_ID}@${PHASE18_E2E_EMAIL_DOMAIN}`;
  const password = randomBytes(18).toString("base64url");

  const { data, error } = await safely<{ user: { id: string } | null }>(() =>
    supabase.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (error || !data?.user) {
    throw new Error(`Failed to create ${role} identity (${tag}): ${error?.message}`);
  }

  let partial: Phase18Identity = {
    role,
    authUserId: data.user.id,
    email,
    password,
    profileId: null,
    firstName,
    lastName,
  };

  const { error: roleError } = await safely(() =>
    supabase.from("user_roles").insert({ auth_user_id: partial.authUserId, role }),
  );
  if (roleError) {
    throw new Phase18PartialIdentityError(
      `Failed to assign ${role} role (auth user WAS already created): ${roleError.message}`,
      partial,
    );
  }

  const profile =
    role === "admin"
      ? { table: "admins", row: { role_level: "admin" } }
      : role === "trainer"
        ? { table: "trainers", row: {} }
        : {
            table: "students",
            // Distinct phone block from every earlier phase's (9903-...).
            row: {
              phone: `9903${randomInt(10, 100)}${randomInt(1000, 10000)}`.slice(0, 10),
            },
          };

  const { data: profileRow, error: profileError } = await safely<{ id: string }>(() =>
    supabase
      .from(profile.table)
      .insert({
        auth_user_id: partial.authUserId,
        first_name: firstName,
        last_name: lastName,
        email,
        ...profile.row,
      })
      .select("id")
      .single(),
  );
  if (profileError || !profileRow) {
    throw new Phase18PartialIdentityError(
      `Failed to create ${profile.table} row (auth user + user_roles WERE already created): ${profileError?.message}`,
      partial,
    );
  }
  partial = { ...partial, profileId: profileRow.id };
  return partial;
}

/**
 * Exact, FK-aware cleanup for one synthetic identity: notifications that
 * this exact auth user received or sent (by exact auth user id — never by
 * title, date, status, or domain), then the exact profile row, then the
 * auth user (user_roles cascades). audit_logs rows are never touched;
 * their actor id is nulled by the existing ON DELETE SET NULL.
 */
export async function deletePhase18Identity(
  identity: Phase18Identity,
): Promise<Phase18DeleteResult> {
  const supabase = serviceClient();

  for (const column of ["recipient_auth_user_id", "created_by_auth_user_id"] as const) {
    const { error } = await safely(() =>
      supabase.from("notifications").delete().eq(column, identity.authUserId),
    );
    if (error) {
      return {
        ok: false,
        reason: `Could not delete notifications by ${column}: ${error.message}`,
      };
    }
  }

  if (identity.profileId) {
    const table =
      identity.role === "admin"
        ? "admins"
        : identity.role === "trainer"
          ? "trainers"
          : "students";
    const { error } = await safely(() =>
      supabase.from(table).delete().eq("id", identity.profileId),
    );
    if (error) {
      return { ok: false, reason: `Could not delete ${table} row: ${error.message}` };
    }
  }

  const { error: authError } = await safely<unknown>(() =>
    supabase.auth.admin.deleteUser(identity.authUserId),
  );
  if (authError) {
    return { ok: false, reason: `Could not delete auth user: ${authError.message}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Authenticated clients — the real production authorization path.

export async function signInAs(identity: Phase18Identity): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: identity.email,
    password: identity.password,
  });
  if (error) {
    throw new Error(
      `Failed to sign in ${identity.role} fixture identity: ${error.message}`,
    );
  }
  return client;
}

export function anonymousClient(): SupabaseClient {
  return anonClient();
}

/**
 * Sends a notification exactly as the app does — as a signed-in Admin,
 * through RLS (notifications_insert_admin_message requires created_by =
 * auth.uid()) — for tests whose subject is the recipient side, not the
 * Admin send UI (Test 1 covers that UI end to end).
 */
export async function sendNotificationAsAdmin(input: {
  admin: Phase18Identity;
  recipient: Phase18Identity;
  title: string;
  body: string;
}): Promise<string> {
  const client = await signInAs(input.admin);
  try {
    const { data, error } = await client
      .from("notifications")
      .insert({
        recipient_auth_user_id: input.recipient.authUserId,
        created_by_auth_user_id: input.admin.authUserId,
        type: "admin_message",
        title: input.title,
        body: input.body,
        channel: "in_app",
        status: "unread",
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Admin fixture send failed: ${error?.message}`);
    }
    return data.id as string;
  } finally {
    await client.auth.signOut().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Read-only verification (service role, never used to prove a policy).

export type StoredNotification = {
  id: string;
  recipient_auth_user_id: string;
  created_by_auth_user_id: string | null;
  type: string;
  title: string;
  body: string | null;
  channel: string;
  status: string;
  read_at: string | null;
};

export async function readNotificationsForRecipient(
  recipientAuthUserId: string,
): Promise<StoredNotification[]> {
  const { data, error } = await serviceClient()
    .from("notifications")
    .select(
      "id, recipient_auth_user_id, created_by_auth_user_id, type, title, body, channel, status, read_at",
    )
    .eq("recipient_auth_user_id", recipientAuthUserId);
  if (error) throw new Error(`Could not read notifications: ${error.message}`);
  return (data ?? []) as StoredNotification[];
}

export async function readNotification(id: string): Promise<StoredNotification | null> {
  const { data, error } = await serviceClient()
    .from("notifications")
    .select(
      "id, recipient_auth_user_id, created_by_auth_user_id, type, title, body, channel, status, read_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read notification: ${error.message}`);
  return (data as StoredNotification | null) ?? null;
}

export async function readSendAuditRows(notificationId: string): Promise<
  Array<{
    action: string;
    actor_auth_user_id: string | null;
    actor_role: string | null;
    after_data: Record<string, unknown> | null;
  }>
> {
  const { data, error } = await serviceClient()
    .from("audit_logs")
    .select("action, actor_auth_user_id, actor_role, after_data")
    .eq("entity_type", "notification")
    .eq("entity_id", notificationId);
  if (error) throw new Error(`Could not read audit rows: ${error.message}`);
  return (data ?? []) as Array<{
    action: string;
    actor_auth_user_id: string | null;
    actor_role: string | null;
    after_data: Record<string, unknown> | null;
  }>;
}
