import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(
    async () => new Response(null, { headers: { "x-session": "refreshed" } }),
  ),
}));

import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import {
  WEBSITE_PRIVATE_HEADERS,
  applyWebsitePrivateHeaders,
  isWebsiteManagementPath,
} from "@/lib/domain/website-private-headers";

describe("isWebsiteManagementPath", () => {
  it.each([
    "/admin/website",
    "/admin/website/pages/aaaaaaaa-0000-4000-8000-000000000001",
    "/admin/website/pages/aaaaaaaa-0000-4000-8000-000000000001/preview",
    "/admin/website/pages/aaaaaaaa-0000-4000-8000-000000000001/history",
  ])("covers %s", (path) => {
    expect(isWebsiteManagementPath(path)).toBe(true);
  });

  it.each(["/admin", "/admin/websites", "/admin/settings", "/website", "/"])(
    "leaves %s alone",
    (path) => {
      expect(isWebsiteManagementPath(path)).toBe(false);
    },
  );
});

describe("preview and editor response headers", () => {
  it("are private, never stored and never indexed", () => {
    expect(WEBSITE_PRIVATE_HEADERS["Cache-Control"]).toMatch(/private/);
    expect(WEBSITE_PRIVATE_HEADERS["Cache-Control"]).toMatch(/no-store/);
    expect(WEBSITE_PRIVATE_HEADERS["X-Robots-Tag"]).toMatch(/noindex/);
    const headers = new Headers({ "Cache-Control": "public, max-age=600" });
    applyWebsitePrivateHeaders(headers);
    expect(headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
  });

  it("are added by proxy.ts to Website Management routes only", async () => {
    const preview = await proxy(
      new NextRequest(
        "http://localhost/admin/website/pages/aaaaaaaa-0000-4000-8000-000000000001/preview",
      ),
    );
    expect(preview.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(preview.headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
    expect(preview.headers.get("x-session")).toBe("refreshed");

    const other = await proxy(new NextRequest("http://localhost/admin/students"));
    expect(other.headers.get("X-Robots-Tag")).toBeNull();
  });
});
