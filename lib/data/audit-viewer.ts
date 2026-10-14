import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import {
  AUDIT_PAGE_SIZE,
  istDayStartIso,
  istNextDayStartIso,
  summarizeAuditData,
  type AuditFilters,
} from "@/lib/domain/audit-viewer";

/**
 * Phase 21C — Audit Log viewer reads. Always through the viewer's own
 * session: RLS shows a Super Admin every row and an Admin every row except
 * admin_account entries; nobody can write or delete (unchanged). Actor
 * names are resolved through the same session, so a name the viewer may
 * not read simply shows as the role.
 */

export type AuditLogEntry = {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string;
  actorRole: string | null;
  actorName: string | null;
  before: Array<{ key: string; value: string }>;
  after: Array<{ key: string; value: string }>;
};

export type AuditLogPage = {
  rows: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
};

type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_role: string | null;
  actor_auth_user_id: string | null;
  before_data: unknown;
  after_data: unknown;
};

function log(message: string, error?: unknown) {
  console.error(`[audit-viewer] ${message}:`, error);
}

async function actorNames(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  ids: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const [admins, trainers, students] = await Promise.all([
    supabase
      .from("admins")
      .select("auth_user_id, first_name, last_name")
      .in("auth_user_id", ids),
    supabase
      .from("trainers")
      .select("auth_user_id, first_name, last_name")
      .in("auth_user_id", ids),
    supabase
      .from("students")
      .select("auth_user_id, first_name, last_name")
      .in("auth_user_id", ids),
  ]);
  for (const result of [admins, trainers, students]) {
    for (const row of (result.data ?? []) as Array<{
      auth_user_id: string | null;
      first_name: string;
      last_name: string;
    }>) {
      if (row.auth_user_id)
        names.set(row.auth_user_id, `${row.first_name} ${row.last_name}`.trim());
    }
  }
  return names;
}

export async function listAuditLogs(
  filters: AuditFilters,
): Promise<DataResult<AuditLogPage>> {
  try {
    const supabase = await createSupabaseServerClient();
    const fromRow = (filters.page - 1) * AUDIT_PAGE_SIZE;
    let query = supabase
      .from("audit_logs")
      .select(
        "id, created_at, action, entity_type, entity_id, actor_role, actor_auth_user_id, before_data, after_data",
        { count: "exact" },
      );
    if (filters.from) query = query.gte("created_at", istDayStartIso(filters.from));
    if (filters.to) query = query.lt("created_at", istNextDayStartIso(filters.to));
    if (filters.action) {
      query = filters.action.endsWith(".")
        ? query.like("action", `${filters.action}%`)
        : query.eq("action", filters.action);
    }
    if (filters.entityType) query = query.eq("entity_type", filters.entityType);
    if (filters.actorRole) {
      query =
        filters.actorRole === "system"
          ? query.is("actor_auth_user_id", null)
          : query.eq("actor_role", filters.actorRole);
    }
    if (filters.entityId) query = query.eq("entity_id", filters.entityId);

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(fromRow, fromRow + AUDIT_PAGE_SIZE - 1);
    if (error) throw error;

    const rows = (data as AuditRow[] | null) ?? [];
    const names = await actorNames(
      supabase,
      Array.from(
        new Set(
          rows.map((r) => r.actor_auth_user_id).filter((v): v is string => Boolean(v)),
        ),
      ),
    );
    return {
      ok: true,
      data: {
        rows: rows.map((r) => ({
          id: r.id,
          createdAt: r.created_at,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          actorRole: r.actor_auth_user_id ? r.actor_role : (r.actor_role ?? "system"),
          actorName: r.actor_auth_user_id
            ? (names.get(r.actor_auth_user_id) ?? null)
            : null,
          before: summarizeAuditData(r.before_data),
          after: summarizeAuditData(r.after_data),
        })),
        total: count ?? rows.length,
        page: filters.page,
        pageSize: AUDIT_PAGE_SIZE,
      },
    };
  } catch (error) {
    log("Could not load the audit log", error);
    return { ok: false, error: "Could not load the audit log." };
  }
}
