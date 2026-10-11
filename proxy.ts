import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
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
