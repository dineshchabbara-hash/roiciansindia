import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  applyWebsitePrivateHeaders,
  isWebsiteManagementPath,
} from "@/lib/domain/website-private-headers";
import {
  applyStagingHeaders,
  skipsSessionRefresh,
  stagingAccess,
  stagingGateResponse,
} from "@/lib/staging-access";

export async function proxy(request: NextRequest) {
  // Private staging only: off unless STAGING_MODE or STAGING_ACCESS_* is set,
  // and then fails closed (lib/staging-access.ts).
  const access = stagingAccess();
  const refusal = stagingGateResponse(request.headers.get("authorization"), access);
  if (refusal) return refusal;

  // Build files and image-like paths need no session refresh (unchanged).
  if (skipsSessionRefresh(request.nextUrl.pathname)) {
    const response = NextResponse.next();
    applyStagingHeaders(response.headers, access);
    return response;
  }

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
     * Every path except exactly /api/razorpay/webhook. That route is called
     * by Razorpay's servers and authenticated by Razorpay's HMAC signature,
     * which it always verifies; it reads no session. Static build files go
     * through proxy too (skipping only the session refresh), so a private
     * staging gate covers them as well.
     */
    "/((?!api/razorpay/webhook$).*)",
  ],
};
