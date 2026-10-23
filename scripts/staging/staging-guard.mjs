// Fail-closed checks for staging-only scripts. Pure functions (no network),
// so they are unit-tested in scripts/__tests__/staging-guard.test.ts.
//
// A staging script may write only when ALL of these hold:
//   1. ROICIANS_TARGET=staging is set explicitly;
//   2. STAGING_PROJECT_REF is set, and NEXT_PUBLIC_SUPABASE_URL is exactly
//      https://<that ref>.supabase.co;
//   3. the operator typed the same ref after --confirm;
//   4. PROTECTED_PROJECT_REFS lists the DEV and production refs (at least
//      one), and the staging ref is not among them;
//   5. a legacy JWT service-role key, if used, is a service_role key for
//      that same ref.
// The seeder adds live checks on top: migrations present, and no records
// other than its own fictional accounts.

export const SEED_EMAIL_DOMAIN = "roicians-staging.example";

const REF_PATTERN = /^[a-z0-9]{20}$/;

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * @returns {string[]} problems; empty means the target is the staging project.
 */
export function stagingTargetProblems({
  target,
  url,
  stagingRef,
  confirmRef,
  protectedRefs,
  serviceKey,
}) {
  const problems = [];
  if (target !== "staging") {
    problems.push("Set ROICIANS_TARGET=staging (this script refuses any other target).");
  }
  const ref = (stagingRef ?? "").trim();
  if (!REF_PATTERN.test(ref)) {
    problems.push(
      "Set STAGING_PROJECT_REF to the staging project's 20-character ref (Project Settings → General).",
    );
  }
  let host = "";
  try {
    const parsed = new URL(url ?? "");
    host = parsed.protocol === "https:" ? parsed.hostname : "";
  } catch {
    host = "";
  }
  if (!host || host !== `${ref}.supabase.co`) {
    problems.push(
      "NEXT_PUBLIC_SUPABASE_URL must be exactly https://<STAGING_PROJECT_REF>.supabase.co.",
    );
  }
  if ((confirmRef ?? "").trim() !== ref || !ref) {
    problems.push("Type the staging ref again after --confirm to proceed.");
  }
  const protectedList = (protectedRefs ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (protectedList.length === 0) {
    problems.push(
      "Set PROTECTED_PROJECT_REFS to your DEV and production project refs (comma-separated), so they can never be targeted.",
    );
  } else if (protectedList.includes(ref)) {
    problems.push("STAGING_PROJECT_REF is listed in PROTECTED_PROJECT_REFS. Refusing.");
  }
  if (!serviceKey) {
    problems.push("Set SUPABASE_SERVICE_ROLE_KEY for the staging project.");
  } else {
    const payload = decodeJwtPayload(serviceKey);
    if (payload) {
      if (payload.role !== "service_role") {
        problems.push("SUPABASE_SERVICE_ROLE_KEY is not a service-role key.");
      }
      if (payload.ref && payload.ref !== ref) {
        problems.push("SUPABASE_SERVICE_ROLE_KEY belongs to a different project.");
      }
    }
  }
  return problems;
}

/** True when an email is one of the seeder's own fictional accounts. */
export function isSeedEmail(email) {
  return (
    typeof email === "string" && email.toLowerCase().endsWith(`@${SEED_EMAIL_DOMAIN}`)
  );
}
