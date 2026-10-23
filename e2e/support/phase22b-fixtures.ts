import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * Node-side setup for the Phase 22B-1 Website Management E2E suite
 * (e2e/phase22b-website-management.spec.ts).
 *
 * ISOLATED ONLY. Phase 22A website revisions and audit rows are permanent by
 * design, so this suite must never run against DEV or production (decisions
 * B4 and C3). It runs only when BOTH of these hold:
 *   - PHASE22B_E2E_ISOLATED=1, and
 *   - NEXT_PUBLIC_SUPABASE_URL points at a local, disposable Supabase stack
 *     (http://127.0.0.1 or http://localhost), such as `supabase start` on a
 *     CI runner.
 * Otherwise the suite skips, and every helper here refuses to run.
 *
 * Accounts: synthetic logins on @phase22b-e2e.internal.test with random
 * passwords, created with the local stack's service-role key. The disposable
 * database is thrown away with the runner, so there is no cleanup step.
 *
 * This is intentionally NOT a .spec.ts file.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** True only for an explicitly opted-in, local, disposable Supabase stack. */
export function isIsolatedLocalSupabase(): boolean {
  if (process.env.PHASE22B_E2E_ISOLATED !== "1") return false;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return false;
  try {
    const url = new URL(SUPABASE_URL);
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}

function serviceClient() {
  if (!isIsolatedLocalSupabase()) {
    throw new Error(
      "Refusing to touch a database: Phase 22B E2E runs only against a local, disposable Supabase stack.",
    );
  }
  return createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type TestAccount = {
  email: string;
  password: string;
  role: "super_admin" | "admin" | "trainer" | "student";
  authUserId: string;
};

function email(tag: string): string {
  return `phase22b-${tag}-${RUN_ID}@phase22b-e2e.internal.test`;
}

function password(): string {
  return `P22b-${randomBytes(12).toString("base64url")}`;
}

/** Creates a login with a role and the matching profile row. */
export async function createAccount(
  tag: string,
  role: TestAccount["role"],
  options: { inactive?: boolean } = {},
): Promise<TestAccount> {
  const supabase = serviceClient();
  const account = { email: email(tag), password: password(), role };
  const { data, error } = await supabase.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Could not create ${role}: ${error?.message}`);
  const authUserId = data.user.id;

  const roleInsert = await supabase
    .from("user_roles")
    .insert({ auth_user_id: authUserId, role });
  if (roleInsert.error)
    throw new Error(`Could not assign ${role}: ${roleInsert.error.message}`);

  const name = { first_name: `Phase22B${RUN_ID}`, last_name: tag };
  if (role === "admin" || role === "super_admin") {
    const r = await supabase.from("admins").insert({
      auth_user_id: authUserId,
      ...name,
      email: account.email,
      role_level: role,
      status: options.inactive ? "inactive" : "active",
    });
    if (r.error) throw new Error(`Could not create admin profile: ${r.error.message}`);
  } else if (role === "trainer") {
    const r = await supabase
      .from("trainers")
      .insert({ auth_user_id: authUserId, ...name, email: account.email });
    if (r.error) throw new Error(`Could not create trainer profile: ${r.error.message}`);
  } else {
    const r = await supabase.from("students").insert({
      auth_user_id: authUserId,
      ...name,
      email: account.email,
      phone: `98${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      status: "active",
    });
    if (r.error) throw new Error(`Could not create student profile: ${r.error.message}`);
  }
  return { ...account, authUserId };
}

export type DocumentState = {
  id: string;
  latestRevisionNumber: number;
  publishedRevisionId: string | null;
  latestRevisionId: string | null;
};

/** Reads a website page's publication state directly (verification only). */
export async function readWebsiteDocument(
  pageKey: string,
): Promise<DocumentState | null> {
  const { data, error } = await serviceClient()
    .from("website_documents")
    .select("id, latest_revision_number, published_revision_id, latest_revision_id")
    .eq("page_key", pageKey)
    .maybeSingle();
  if (error) throw new Error(`Could not read website document: ${error.message}`);
  if (!data) return null;
  const row = data as {
    id: string;
    latest_revision_number: number;
    published_revision_id: string | null;
    latest_revision_id: string | null;
  };
  return {
    id: row.id,
    latestRevisionNumber: row.latest_revision_number,
    publishedRevisionId: row.published_revision_id,
    latestRevisionId: row.latest_revision_id,
  };
}

/** Website audit actions recorded for a document (written by the 22A functions). */
export async function readWebsiteAuditActions(documentId: string): Promise<string[]> {
  const { data, error } = await serviceClient()
    .from("audit_logs")
    .select("action, created_at")
    .eq("entity_id", documentId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read audit log: ${error.message}`);
  return ((data ?? []) as Array<{ action: string }>).map((r) => r.action);
}
