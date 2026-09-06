/**
 * No `import "server-only"` guard here (unlike the Supabase clients):
 * this module is never imported from a route/page directly, only from
 * "use server" actions, and keeping it guard-free lets it be unit tested
 * directly under Vitest without a React-server bundler condition.
 *
 * Token-bucket rate limiting for auth endpoints (SECURITY_PLAN.md §11:
 * /login, /forgot-password, /reset-password). Two backends:
 *
 *  - In-memory (default, used when UPSTASH_REDIS_REST_URL/_TOKEN are unset):
 *    fine for local development and a single-instance deployment, but does
 *    NOT share state across multiple serverless instances — noted as a
 *    production gap in the Phase 3 report, not hidden.
 *  - Upstash Redis REST (used automatically when the env vars are present):
 *    shared, correct under Vercel's multi-instance serverless model.
 *
 * Callers never need to know which backend is active.
 */

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

function checkInMemory(
  key: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult {
  const now = Date.now();
  const bucket = memoryBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

async function checkUpstash(
  key: string,
  limit: number,
  windowSeconds: number,
  url: string,
  token: string,
): Promise<RateLimitResult> {
  // Fixed-window counter via Upstash's REST pipeline: INCR then, only on
  // the first hit in the window, EXPIRE. Simple and sufficient for
  // login/reset-style endpoints (a fixed-window counter is a coarser
  // approximation than a true sliding window, which is an acceptable
  // trade-off here).
  const redisKey = `ratelimit:${key}`;
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["EXPIRE", redisKey, String(windowSeconds), "NX"],
      ["TTL", redisKey],
    ]),
  });

  if (!response.ok) {
    // Fail open on the rate limiter's own infrastructure failure — a
    // limiter outage must never itself become a way to lock everyone out
    // of login. The endpoint's own auth checks remain the real gate.
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const results = (await response.json()) as Array<{ result: number }>;
  const count = results[0]?.result ?? 0;
  const ttl = results[2]?.result ?? windowSeconds;

  if (count > limit) {
    return { allowed: false, retryAfterSeconds: Math.max(ttl, 0) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * @param key Unique bucket key, e.g. `login:${email}` or `login:ip:${ip}`.
 *   Combine email/IP at the call site as appropriate for the endpoint.
 */
export async function checkRateLimit(
  key: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): Promise<RateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    return checkUpstash(key, limit, windowSeconds, url, token);
  }
  return checkInMemory(key, limit, windowSeconds);
}
