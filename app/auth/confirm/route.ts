import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * GET /auth/confirm — Phase 21C account activation / password set.
 *
 * Verifies a one-time `token_hash` link server-side (Supabase's
 * recommended SSR flow) and sends the person to /reset-password, where they
 * choose their own password. Unlike /auth/callback's PKCE code exchange,
 * this does not depend on a verifier cookie in the browser that asked for
 * the link, so it also works for a login an Admin provisioned. Only the
 * recovery and invite link types and a fixed list of destinations are
 * accepted; the token is never logged or echoed.
 */

const ALLOWED_TYPES = new Set<EmailOtpType>(["recovery", "invite"]);
const ALLOWED_NEXT_PATHS = new Set(["/reset-password"]);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const rawNext = searchParams.get("next") ?? "/reset-password";
  const next = ALLOWED_NEXT_PATHS.has(rawNext) ? rawNext : "/reset-password";

  if (tokenHash && type && ALLOWED_TYPES.has(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
