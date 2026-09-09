/**
 * Audit-log data minimization. Pure — no I/O. This is the redaction rule
 * SECURITY_PLAN.md's audit_logs comment names ("enforced by a redaction
 * helper at every write call site") — the first phase to actually write
 * audit entries, so this is where that helper is built.
 *
 * Two separate concerns, both enforced here:
 *  1. Defense-in-depth key redaction — strip anything that looks like a
 *     credential, in case a call site ever passes something it shouldn't.
 *  2. Callers are expected to pass already-minimized payloads (e.g.
 *     `{ studentCode }`, not the full student row) — this helper is a
 *     backstop, not a substitute for building the minimal payload in the
 *     first place at each call site.
 */

const SENSITIVE_KEY_PATTERN =
  /password|token|secret|encrypted_|api_key|apikey|credential/i;

export function redactForAudit<T extends Record<string, unknown> | null | undefined>(
  value: T,
): T {
  if (value === null || value === undefined) return value;

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    result[key] = val;
  }
  return result as T;
}
