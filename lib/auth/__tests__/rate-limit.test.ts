import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the in-memory backend specifically: ensure no Upstash env vars
// are set for this test file, regardless of the environment it runs in.
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
});

describe("checkRateLimit (in-memory backend)", () => {
  it("allows requests up to the limit, then blocks", async () => {
    const { checkRateLimit } = await import("@/lib/auth/rate-limit");
    const key = `test:${crypto.randomUUID()}`;
    const options = { limit: 3, windowSeconds: 60 };

    for (let i = 0; i < 3; i++) {
      const result = await checkRateLimit(key, options);
      expect(result.allowed).toBe(true);
    }

    const blocked = await checkRateLimit(key, options);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks independent keys separately", async () => {
    const { checkRateLimit } = await import("@/lib/auth/rate-limit");
    const options = { limit: 1, windowSeconds: 60 };
    const keyA = `test:a:${crypto.randomUUID()}`;
    const keyB = `test:b:${crypto.randomUUID()}`;

    expect((await checkRateLimit(keyA, options)).allowed).toBe(true);
    expect((await checkRateLimit(keyA, options)).allowed).toBe(false);
    // A different key must not be affected by keyA's bucket being full.
    expect((await checkRateLimit(keyB, options)).allowed).toBe(true);
  });

  it("resets once the window elapses", async () => {
    const { checkRateLimit } = await import("@/lib/auth/rate-limit");
    const key = `test:window:${crypto.randomUUID()}`;
    const options = { limit: 1, windowSeconds: 1 };

    expect((await checkRateLimit(key, options)).allowed).toBe(true);
    expect((await checkRateLimit(key, options)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect((await checkRateLimit(key, options)).allowed).toBe(true);
  });
});
