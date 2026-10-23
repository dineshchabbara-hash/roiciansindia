// @vitest-environment node
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(async () => NextResponse.next()),
}));

import { updateSession } from "@/lib/supabase/middleware";
import { config, proxy } from "@/proxy";

// Next's matcher test helper expects AsyncLocalStorage as a global.
let doesMatch: (url: string) => boolean;
beforeAll(async () => {
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage;
  const { unstable_doesMiddlewareMatch } =
    await import("next/experimental/testing/server");
  doesMatch = (url) => unstable_doesMiddlewareMatch({ config, url });
});

const USER = "roicians-preview";
const PASSWORD = "correct-horse-battery-staple";
const basic = (u: string, p: string) =>
  `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
const request = (path: string, authorization?: string) =>
  new NextRequest(`https://staging.example.in${path}`, {
    headers: authorization ? { authorization } : {},
  });

function stagingOn() {
  vi.stubEnv("STAGING_MODE", "1");
  vi.stubEnv("STAGING_ACCESS_USER", USER);
  vi.stubEnv("STAGING_ACCESS_PASSWORD", PASSWORD);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(updateSession).mockClear();
});

// Every path proxy.ts used to skip, plus look-alikes and private routes.
const GATED_PATHS = [
  "/",
  "/login/admin",
  "/admin",
  "/admin/students/abc.png",
  "/student/enrollments/e1.jpg",
  "/verify-certificate",
  "/verify-certificate.png",
  "/api/students/s1/photo",
  "/api/students/s1/photo.png",
  "/api/payments/p1/receipt",
  "/api/exports/payments",
  "/auth/callback",
  "/auth/confirm",
  "/_next/static/chunks/app.js",
  "/_next/static/media/font.woff2",
  "/_next/image?url=%2Fx.png&w=64&q=75",
  "/favicon.ico",
  "/favicon.icox",
  "/logo.svg",
  "/api/razorpay/webhook/extra",
  "/api/razorpay/webhooks",
  "/api/razorpay/webhook.png",
  "/API/razorpay/webhook",
  "/api/razorpay",
];

describe("proxy.ts matcher", () => {
  it("runs on every path except exactly the Razorpay webhook", () => {
    for (const path of GATED_PATHS) expect(doesMatch(path), path).toBe(true);
    expect(doesMatch("/api/razorpay/webhook")).toBe(false);
  });
});

describe("proxy.ts staging gate", () => {
  it.each(GATED_PATHS)("refuses %s without the staging password", async (path) => {
    stagingOn();
    const res = await proxy(request(path));
    expect(res.status).toBe(401);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("refuses everything when staging mode has no valid credentials", async () => {
    vi.stubEnv("STAGING_MODE", "1");
    for (const path of ["/", "/_next/static/chunks/app.js", "/api/exports/payments"]) {
      const res = await proxy(request(path, basic(USER, PASSWORD)));
      expect(res.status).toBe(503);
    }
  });

  it("lets the right password through, marked noindex and uncacheable", async () => {
    stagingOn();
    const page = await proxy(request("/login/admin", basic(USER, PASSWORD)));
    expect(page.status).toBe(200);
    expect(page.headers.get("X-Robots-Tag")).toMatch(/noindex/);
    expect(page.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(updateSession).toHaveBeenCalledTimes(1);

    const asset = await proxy(
      request("/_next/static/chunks/app.js", basic(USER, PASSWORD)),
    );
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(updateSession).toHaveBeenCalledTimes(1); // assets skip the session refresh
  });

  it("changes nothing when staging is off", async () => {
    const page = await proxy(request("/login/admin"));
    expect(page.status).toBe(200);
    expect(page.headers.get("X-Robots-Tag")).toBeNull();
    expect(updateSession).toHaveBeenCalledTimes(1);

    const asset = await proxy(request("/_next/static/chunks/app.js"));
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Cache-Control")).toBeNull();
    expect(updateSession).toHaveBeenCalledTimes(1);
  });
});
