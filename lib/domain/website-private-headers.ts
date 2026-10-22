/**
 * Phase 22B-1 (decision B2, TI-6): Website Management screens show unpublished
 * drafts, so their responses must never be stored by a shared cache or indexed
 * by a search engine. proxy.ts adds these headers to every /admin/website
 * response (the editor, history and preview). The pages are also rendered on
 * demand (force-dynamic), behind the Admin session check.
 */
export const WEBSITE_PRIVATE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export function isWebsiteManagementPath(pathname: string): boolean {
  return pathname === "/admin/website" || pathname.startsWith("/admin/website/");
}

export function applyWebsitePrivateHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(WEBSITE_PRIVATE_HEADERS)) {
    headers.set(name, value);
  }
}
