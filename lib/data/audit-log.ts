import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redactForAudit } from "@/lib/domain/audit";
import type { Role } from "@/lib/domain/rbac";

// Phase 17 (Certificates) finding: two independent live runs each showed
// the full certificate issuance pipeline — including this very INSERT —
// completing and committing correctly (confirmed directly against the
// remote audit_logs row itself), while the calling Server Action never
// returned to the browser, which then sat on an unresolved
// `useActionState` promise until its own test-level timeout. The only
// awaited work between "certificate fully issued" and "the action
// returns" is this one insert — so the write itself was never the
// problem, only this function's own unbounded `await` on acknowledging
// it: a slow/dropped response for an INSERT that already committed
// server-side still blocks the caller forever under the old code, which
// directly contradicts this function's own documented contract below
// ("must not block the underlying action"). withTimeout enforces that
// contract for real: once AUDIT_LOG_TIMEOUT_MS elapses, this function
// returns regardless of whether the underlying request ever settles. This
// is not a retry (nothing is re-attempted) and does not change what gets
// written or when the write itself happens — only how long a caller can
// ever be made to wait for the write's own acknowledgment.
const AUDIT_LOG_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Single write path for `audit_logs`. Always via the service-role client:
 * RLS on `audit_logs` grants `authenticated` SELECT only (admin/super_admin)
 * — there is no insert policy for any end-user role by design (see
 * 20260101000014_rls_policies.sql). Every caller is expected to pass an
 * already-minimized payload (see SECURITY_PLAN.md §13 / audit-data
 * minimization) — `redactForAudit` is a defense-in-depth backstop, not a
 * substitute for building a minimal payload at the call site.
 *
 * Never throws, and never blocks its caller past AUDIT_LOG_TIMEOUT_MS: a
 * failed OR merely slow-to-acknowledge audit write must not block the
 * underlying action it's recording (the action already happened), but is
 * logged server-side for operational visibility either way.
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
    const { error } = await withTimeout(
      supabase.from("audit_logs").insert({
        actor_auth_user_id: entry.actorAuthUserId,
        actor_role: entry.actorRole,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        before_data: redactForAudit(entry.before ?? null),
        after_data: redactForAudit(entry.after ?? null),
      }),
      AUDIT_LOG_TIMEOUT_MS,
      "audit_logs insert",
    );
    if (error) throw error;
  } catch (error) {
    console.error(
      `[audit log] failed to write ${entry.action} for ${entry.entityType}:`,
      error,
    );
  }
}
