/**
 * Private staging gate (self-hosted staging only, e.g. Hostinger).
 *
 * Off unless STAGING_ACCESS_PASSWORD is set, so local development, tests,
 * DEV and production behave exactly as before. When set, every request that
 * reaches proxy.ts must carry HTTP Basic credentials for STAGING_ACCESS_USER
 * (default "staging") and that password, and every response is marked
 * noindex. The LMS's own role logins still apply behind it.
 *
 * Not gated: whatever proxy.ts's matcher already skips: static build files,
 * public images and the Razorpay webhook (signature-verified, called by
 * Razorpay's servers, which cannot answer a password prompt).
 *
 * Fails closed: a password shorter than STAGING_ACCESS_MIN_LENGTH refuses
 * every request rather than protecting the site weakly.
 */

export const STAGING_ACCESS_MIN_LENGTH = 16;
export const STAGING_ACCESS_DEFAULT_USER = "staging";
export const STAGING_NOINDEX = "noindex, nofollow, noarchive";

export type StagingAccess =
  | { mode: "off" }
  | { mode: "misconfigured" }
  | { mode: "on"; user: string; password: string };

type Env = Record<string, string | undefined>;

export function stagingAccess(env: Env = process.env): StagingAccess {
  const password = env.STAGING_ACCESS_PASSWORD;
  if (password === undefined || password === "") return { mode: "off" };
  if (password.length < STAGING_ACCESS_MIN_LENGTH) return { mode: "misconfigured" };
  const user = env.STAGING_ACCESS_USER?.trim() || STAGING_ACCESS_DEFAULT_USER;
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
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": STAGING_NOINDEX,
  "Content-Type": "text/plain; charset=utf-8",
};

/**
 * The response that stops a request at the gate, or null to let it through.
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

/** Marks a response noindex whenever the staging gate is on. */
export function applyStagingHeaders(
  headers: Headers,
  access: StagingAccess = stagingAccess(),
): void {
  if (access.mode !== "off") headers.set("X-Robots-Tag", STAGING_NOINDEX);
}
