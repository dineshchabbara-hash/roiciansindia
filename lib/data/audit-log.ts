import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redactForAudit } from "@/lib/domain/audit";
import type { Role } from "@/lib/domain/rbac";

/**
 * Single write path for `audit_logs`. Always via the service-role client:
 * RLS on `audit_logs` grants `authenticated` SELECT only (admin/super_admin)
 * — there is no insert policy for any end-user role by design (see
 * 20260101000014_rls_policies.sql). Every caller is expected to pass an
 * already-minimized payload (see SECURITY_PLAN.md §13 / audit-data
 * minimization) — `redactForAudit` is a defense-in-depth backstop, not a
 * substitute for building a minimal payload at the call site.
 *
 * Never throws: a failed audit write must not block the underlying action
 * it's recording (the action already happened), but is logged server-side
 * for operational visibility.
 */
export async function writeAuditLog(entry: {
  actorAuthUserId: string;
  actorRole: Role;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("audit_logs").insert({
      actor_auth_user_id: entry.actorAuthUserId,
      actor_role: entry.actorRole,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      before_data: redactForAudit(entry.before ?? null),
      after_data: redactForAudit(entry.after ?? null),
    });
    if (error) throw error;
  } catch (error) {
    console.error(
      `[audit log] failed to write ${entry.action} for ${entry.entityType}:`,
      error,
    );
  }
}
