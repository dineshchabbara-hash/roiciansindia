import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  applyWebsitePrivateHeaders,
  isWebsiteManagementPath,
} from "@/lib/domain/website-private-headers";
import {
  applyStagingHeaders,
  stagingAccess,
  stagingGateResponse,
} from "@/lib/staging-access";

export async function proxy(request: NextRequest) {
  // Private staging only: inert unless STAGING_ACCESS_PASSWORD is set.
  const access = stagingAccess();
  const refusal = stagingGateResponse(request.headers.get("authorization"), access);
  if (refusal) return refusal;

  const response = await updateSession(request);
  applyStagingHeaders(response.headers, access);
  // Phase 22B-1: Website Management screens show unpublished drafts, so they
  // are never cached by a shared cache or indexed (B2, TI-6).
  if (isWebsiteManagementPath(request.nextUrl.pathname)) {
    applyWebsitePrivateHeaders(response.headers);
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Match every request except static assets and Next.js internals, so
     * the session cookie stays fresh across normal navigation without
     * doing unnecessary work on every image/font/etc. The Razorpay webhook
     * (Phase 20B) is also excluded: it is authenticated by Razorpay's
     * signature, never by a session, so refreshing a cookie there is waste.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/razorpay/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
