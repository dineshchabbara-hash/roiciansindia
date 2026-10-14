/**
 * Phase 21C — read-only Audit Log viewer. Pure.
 *
 * Visibility is decided by RLS (Super Admin: everything; Admin: everything
 * except admin_account entries); this module only parses filters and
 * prepares rows for display. audit_logs never holds secrets (every writer
 * minimizes and redacts), and display adds one more backstop: any key that
 * looks like a credential or provider signature is masked, nested values
 * are flattened to short text, and long values are truncated.
 */

export const AUDIT_PAGE_SIZE = 50;

/** Every entity type the application writes to audit_logs (filter list). */
export const AUDIT_ENTITY_TYPES = [
  "admin_account",
  "assignment",
  "assignment_submission",
  "batch",
  "certificate",
  "class_session",
  "company_settings",
  "enrollment",
  "installment",
  "material",
  "notification",
  "payment",
  "payment_plan",
  "program",
  "receipt",
  "refund",
  "student",
  "student_document",
  "student_note",
  "trainer",
] as const;

export type AuditFilters = {
  from: string | null; // YYYY-MM-DD (Asia/Kolkata), inclusive
  to: string | null; // YYYY-MM-DD (Asia/Kolkata), inclusive
  action: string | null; // exact action or a prefix ending in "."
  entityType: string | null;
  actorRole: string | null;
  entityId: string | null;
  page: number;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_PATTERN = /^[a-z_]+(\.[a-z_]+)*\.?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = new Set(["super_admin", "admin", "trainer", "student", "system"]);

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Parses URL search params into safe filters (anything invalid is dropped). */
export function parseAuditFilters(
  params: Record<string, string | string[] | undefined>,
): AuditFilters {
  const from = single(params.from);
  const to = single(params.to);
  const action = single(params.action).toLowerCase();
  const entityType = single(params.entity).toLowerCase();
  const actorRole = single(params.role).toLowerCase();
  const entityId = single(params.id).toLowerCase();
  const page = Number.parseInt(single(params.page), 10);
  return {
    from: DATE_PATTERN.test(from) ? from : null,
    to: DATE_PATTERN.test(to) ? to : null,
    action: action && action.length <= 80 && TOKEN_PATTERN.test(action) ? action : null,
    entityType:
      entityType && entityType.length <= 60 && /^[a-z_]+$/.test(entityType)
        ? entityType
        : null,
    actorRole: ROLES.has(actorRole) ? actorRole : null,
    entityId: UUID_PATTERN.test(entityId) ? entityId : null,
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

/** Start of an IST day as an ISO timestamp (UTC). */
export function istDayStartIso(day: string): string {
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

/** Start of the IST day after `day`, for an exclusive upper bound. */
export function istNextDayStartIso(day: string): string {
  const start = new Date(`${day}T00:00:00+05:30`);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

const MASKED_KEY =
  /password|passwd|token|secret|signature|api_?key|credential|otp|card|cvv|account_?number|ifsc|vpa/i;
const MAX_VALUE_LENGTH = 120;
const MAX_FIELDS = 20;

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** Flattened, masked "key: value" pairs for one before/after payload. */
export function summarizeAuditData(data: unknown): Array<{ key: string; value: string }> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  return Object.entries(data as Record<string, unknown>)
    .slice(0, MAX_FIELDS)
    .map(([key, value]) => {
      if (MASKED_KEY.test(key)) return { key, value: "[hidden]" };
      const text = displayValue(value);
      return {
        key,
        value:
          text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text,
      };
    });
}

/** Query string for a page of the current filters (pagination links). */
export function auditFilterQuery(filters: AuditFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entity", filters.entityType);
  if (filters.actorRole) params.set("role", filters.actorRole);
  if (filters.entityId) params.set("id", filters.entityId);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `?${query}` : "";
}
