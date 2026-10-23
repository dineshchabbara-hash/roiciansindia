/**
 * Private staging gate (self-hosted staging only, e.g. Hostinger).
 *
 * Switched on by STAGING_MODE=1 (the explicit switch the staging deployment
 * sets), or by STAGING_ACCESS_PASSWORD being present at all. Once on, it
 * FAILS CLOSED: unless STAGING_ACCESS_USER and STAGING_ACCESS_PASSWORD are
 * both present and valid, every request is refused (503). With valid
 * credentials, every request that reaches proxy.ts must carry matching HTTP
 * Basic credentials, and every response is marked noindex and uncacheable.
 * The LMS's own role logins still apply behind it.
 *
 * Off (no STAGING_MODE, no STAGING_ACCESS_* values): behaviour is unchanged
 * for local development, tests, DEV and production.
 *
 * proxy.ts runs on every path except exactly /api/razorpay/webhook, which
 * Razorpay's servers call with an HMAC signature that the route always
 * verifies (they cannot answer a password prompt). Static build files are
 * gated too.
 */

export const STAGING_ACCESS_MIN_LENGTH = 16;
export const STAGING_ACCESS_MAX_LENGTH = 256;
export const STAGING_NOINDEX = "noindex, nofollow, noarchive";
export const STAGING_CACHE_CONTROL = "private, no-store, max-age=0";

export type StagingAccess =
  | { mode: "off" }
  | { mode: "misconfigured"; reason: string }
  | { mode: "on"; user: string; password: string };

type Env = Record<string, string | undefined>;

const ON_VALUES = new Set(["1", "true", "on", "yes", "enabled"]);
const OFF_VALUES = new Set(["0", "false", "off", "no", "disabled"]);
// No control characters (Basic credentials are one header line).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function isPresent(value: string | undefined): boolean {
  return value !== undefined;
}

export function stagingAccess(env: Env = process.env): StagingAccess {
  const rawMode = env.STAGING_MODE?.trim().toLowerCase();
  const anyCredential =
    isPresent(env.STAGING_ACCESS_USER) || isPresent(env.STAGING_ACCESS_PASSWORD);

  let enabled: boolean;
  if (rawMode === undefined || rawMode === "") {
    enabled = anyCredential;
  } else if (ON_VALUES.has(rawMode)) {
    enabled = true;
  } else if (OFF_VALUES.has(rawMode)) {
    // Credentials present while switched off is contradictory: fail closed.
    if (anyCredential) {
      return {
        mode: "misconfigured",
        reason: "STAGING_MODE is off but credentials are set",
      };
    }
    enabled = false;
  } else {
    return { mode: "misconfigured", reason: "STAGING_MODE has an unrecognised value" };
  }
  if (!enabled) return { mode: "off" };

  const user = env.STAGING_ACCESS_USER?.trim() ?? "";
  const password = env.STAGING_ACCESS_PASSWORD ?? "";
  if (!user) return { mode: "misconfigured", reason: "STAGING_ACCESS_USER is missing" };
  if (user.includes(":") || CONTROL_CHARS.test(user) || user.length > 64) {
    return { mode: "misconfigured", reason: "STAGING_ACCESS_USER is invalid" };
  }
  if (!password) {
    return { mode: "misconfigured", reason: "STAGING_ACCESS_PASSWORD is missing" };
  }
  if (
    password.length < STAGING_ACCESS_MIN_LENGTH ||
    password.length > STAGING_ACCESS_MAX_LENGTH ||
    CONTROL_CHARS.test(password) ||
    password.trim() !== password ||
    password.toLowerCase().includes(user.toLowerCase())
  ) {
    return { mode: "misconfigured", reason: "STAGING_ACCESS_PASSWORD is invalid" };
  }
  return { mode: "on", user, password };
}

/** Compares in time independent of where the strings differ. */
function sameText(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export function hasStagingCredentials(
  authorization: string | null,
  access: Extract<StagingAccess, { mode: "on" }>,
): boolean {
  if (!authorization) return false;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(authorization);
  if (!match) return false;
  let decoded: string;
  try {
    const binary = atob(match[1]);
    decoded = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  const userOk = sameText(decoded.slice(0, colon), access.user);
  const passwordOk = sameText(decoded.slice(colon + 1), access.password);
  return userOk && passwordOk;
}

const REFUSAL_HEADERS = {
  "Cache-Control": STAGING_CACHE_CONTROL,
  "X-Robots-Tag": STAGING_NOINDEX,
  "Content-Type": "text/plain; charset=utf-8",
};

/**
 * The response that stops a request at the gate, or null to let it through.
 * The misconfiguration reason is never sent to the visitor.
 */
export function stagingGateResponse(
  authorization: string | null,
  access: StagingAccess = stagingAccess(),
): Response | null {
  if (access.mode === "off") return null;
  if (access.mode === "misconfigured") {
    return new Response("This staging site is not configured for access.", {
      status: 503,
      headers: REFUSAL_HEADERS,
    });
  }
  if (hasStagingCredentials(authorization, access)) return null;
  return new Response("Private staging site. Sign in to continue.", {
    status: 401,
    headers: {
      ...REFUSAL_HEADERS,
      "WWW-Authenticate": 'Basic realm="ROICIANS staging", charset="UTF-8"',
    },
  });
}

/** Marks a response noindex and uncacheable whenever staging mode is on. */
export function applyStagingHeaders(
  headers: Headers,
  access: StagingAccess = stagingAccess(),
): void {
  if (access.mode === "off") return;
  headers.set("X-Robots-Tag", STAGING_NOINDEX);
  headers.set("Cache-Control", STAGING_CACHE_CONTROL);
}

/**
 * Paths that need no Supabase session refresh (build files and image-like
 * paths). They are still gated in staging; this only skips the refresh, as
 * proxy.ts's matcher did before it was narrowed.
 */
export function skipsSessionRefresh(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname === "/_next/image" ||
    pathname === "/favicon.ico" ||
    /\.(?:svg|png|jpg|jpeg|gif|webp)$/i.test(pathname)
  );
}

/** The one path proxy.ts never runs on. */
export const RAZORPAY_WEBHOOK_PATH = "/api/razorpay/webhook";
